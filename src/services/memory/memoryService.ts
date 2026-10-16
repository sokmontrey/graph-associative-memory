import { randomUUID } from "node:crypto";
import { MEMORY_EDGE_TABLE, MEMORY_NODE_LABEL } from "../../db/relations.ts";
import {
  MEMORY_EDGE_PROPS,
  MEMORY_NODE_FIELDS,
  mapMemoryEdge,
  mapMemoryNode,
  type MemoryNodePatch,
  type MemoryNodeUpsert,
} from "../../models/index.ts";
import {
  MEMORY_POLICY,
  saturatingReinforce,
  type MemoryEdge,
  type MemoryNode,
  type MemoryTools,
} from "../../models/memory-graph.ts";
import type { EdgeRepo } from "../../repos/edges/index.ts";
import { LadybugEdgeRepo } from "../../repos/edges/index.ts";
import type { GraphDbRepo } from "../../repos/graphDb/index.ts";
import { LadybugNodeRepo, type NodeRepo } from "../../repos/node/index.ts";
import {
  cosineSimilarity,
  embedDocTexts,
  embedQueryText,
  type TextEmbedder,
  type Vector,
} from "../embeddings/index.ts";
import type { MemorySearchProvider } from "../search/index.ts";
import {
  createMemoryEventBus,
  NOOP_MEMORY_EVENTS,
  type MemoryEventBus,
  type MemoryOpKind,
} from "./events.ts";

const SEARCH_OVERSAMPLE = 3;

export const MEMORY_EDGE_TABLE_CONFIG = {
  table: MEMORY_EDGE_TABLE,
  fromLabel: MEMORY_NODE_LABEL,
  toLabel: MEMORY_NODE_LABEL,
  props: [...MEMORY_EDGE_PROPS],
} as const;

export type MemoryServiceDeps = {
  db: GraphDbRepo;
  embedder: TextEmbedder;
  search: MemorySearchProvider;
  /** Lexical fallback when vector search misses. Defaults to ContainsMemorySearch. */
  fallback?: MemorySearchProvider;
  events?: MemoryEventBus;
  nodeRepo?: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  edgeRepo?: EdgeRepo;
};

function assertCount(n: number | undefined, what: string): void {
  if (n === undefined) return;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${what} must be a non-negative integer, got ${n}`);
  }
}

// Thin low-level graph service implementing MemoryTools. Reads are pure (no
// side effects). The ONLY way importance/strength go up is reinforce*; tick()
// (server schedule, never exposed) is the only way they go down.
export class MemoryService implements MemoryTools {
  private readonly db: GraphDbRepo;
  private readonly nodeRepo: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  private readonly edgeRepo: EdgeRepo;
  private readonly embedder: TextEmbedder;
  private readonly searchProvider: MemorySearchProvider;
  private readonly fallback: MemorySearchProvider | null;
  private readonly events: MemoryEventBus;
  /** Sliding window of add() timestamps: hard cap per subagent run. */
  private addTimes: number[] = [];
  /** Operations since the last decay step: every op counts toward a tick. */
  private opsSinceTick = 0;

  private constructor(
    db: GraphDbRepo,
    nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>,
    edges: EdgeRepo,
    embedder: TextEmbedder,
    search: MemorySearchProvider,
    fallback: MemorySearchProvider | null,
    events: MemoryEventBus
  ) {
    this.db = db;
    this.nodeRepo = nodes;
    this.edgeRepo = edges;
    this.embedder = embedder;
    this.searchProvider = search;
    this.fallback = fallback;
    this.events = events;
  }

  static async create(deps: MemoryServiceDeps): Promise<MemoryService> {
    const nodes =
      deps.nodeRepo ??
      new LadybugNodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>(deps.db, {
        label: MEMORY_NODE_LABEL,
        fields: MEMORY_NODE_FIELDS,
        map: mapMemoryNode,
      });
    const edges = deps.edgeRepo ?? new LadybugEdgeRepo(deps.db, [MEMORY_EDGE_TABLE_CONFIG]);
    const events = deps.events ?? NOOP_MEMORY_EVENTS;
    return new MemoryService(
      deps.db,
      nodes,
      edges,
      deps.embedder,
      deps.search,
      deps.fallback ?? null,
      events
    );
  }

  // ---- READ: pure, no side effects ----

  async search(query: string, n = 10, kind?: string): Promise<MemoryNode[]> {
    return this.instrument("search", { query, n, kind: kind ?? null }, async (emit) => {
      assertCount(n, "n");
      if (n === 0 || query.trim().length === 0) return [];
      let hits = await this.searchProvider.searchNodes(query, n * SEARCH_OVERSAMPLE);
      if (hits.length === 0 && this.fallback) {
        hits = await this.fallback.searchNodes(query, n * SEARCH_OVERSAMPLE);
        emit("fallback", { query, hits: hits.length });
      }
      // Relevance floor first: drop everything below the threshold instead of
      // padding with unrelated rows.
      const relevant = hits.filter((hit) => hit.score >= MEMORY_POLICY.RELEVANCE_THRESHOLD);
      emit("relevant", { hits: hits.length, kept: relevant.length });
      if (relevant.length === 0) return [];
      const found = await this.nodeRepo.findAll({ where: { id: relevant.map((hit) => hit.id) } });
      const byId = new Map(found.map((node) => [node.id, node]));
      const alpha = MEMORY_POLICY.IMPORTANCE_ALPHA;
      const wanted = kind?.trim();
      return relevant
        .map((hit) => ({ hit, node: byId.get(hit.id) }))
        .filter((entry): entry is { hit: (typeof relevant)[number]; node: MemoryNode } =>
          entry.node !== undefined && (wanted === undefined || wanted.length === 0 || entry.node.kind === wanted)
        )
        .map(({ hit, node }) => ({ node, score: hit.score * Math.pow(node.importance, alpha) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map((entry) => entry.node);
    });
  }

  async recent(n = 10, kind?: string): Promise<MemoryNode[]> {
    return this.instrument("recent", { n, kind: kind ?? null }, async () => {
      assertCount(n, "n");
      if (n === 0) return [];
      return this.nodeRepo.findAll({
        ...(kind ? { where: { kind } } : {}),
        orderBy: "createdAt",
        orderDir: "DESC",
        limit: n,
      });
    });
  }

  async top(n = 10): Promise<MemoryNode[]> {
    return this.instrument("top", { n }, async () => {
      assertCount(n, "n");
      if (n === 0) return [];
      return this.nodeRepo.findAll({ orderBy: "importance", orderDir: "DESC", limit: n });
    });
  }

  async get(ids: string[]): Promise<MemoryNode[]> {
    return this.instrument("get", { ids }, async () => {
      if (ids.length === 0) return [];
      const found = await this.nodeRepo.findAll({ where: { id: [...new Set(ids)] } });
      const byId = new Map(found.map((node) => [node.id, node]));
      return ids.map((id) => byId.get(id)).filter((node): node is MemoryNode => node !== undefined);
    });
  }

  async edges(
    nodeId: string,
    opts: { relation?: string; query?: string; n?: number } = {}
  ): Promise<MemoryEdge[]> {
    return this.instrument("edges", { nodeId, ...opts }, async () => {
      assertCount(opts.n, "n");
      const rows = await this.edgeRepo.list({
        table: MEMORY_EDGE_TABLE,
        fromId: nodeId,
        direction: "both",
        ...(opts.relation ? { where: { relation: opts.relation } } : {}),
        orderBy: "strength",
        orderDir: "DESC",
        ...(opts.n !== undefined ? { limit: opts.n } : {}),
      });
      let out = rows.map(mapMemoryEdge);
      // Optional semantic filter over the edge descriptions (bounded fan-out).
      const query = opts.query?.trim();
      if (query) {
        const [queryVector, docVectors] = await Promise.all([
          embedQueryText(this.embedder, query),
          embedDocTexts(
            this.embedder,
            out.map((edge) => `${edge.relation} ${edge.description}`)
          ),
        ]);
        out = out
          .map((edge, i) => ({ edge, score: cosineSimilarity(queryVector, docVectors[i]!) }))
          .filter((entry) => entry.score >= MEMORY_POLICY.RELEVANCE_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.edge);
        if (opts.n !== undefined) out = out.slice(0, opts.n);
      }
      return out;
    });
  }

  // ---- WRITE ----

  async add(input: { content: string; kind: string }): Promise<MemoryNode> {
    return this.instrument("add", { kind: input.kind }, async (emit) => {
      const content = input.content.trim();
      if (content.length === 0) throw new Error("add: content must be non-empty");
      if (input.kind.trim().length === 0) throw new Error("add: kind must be non-empty");
      this.checkAddBudget();
      // Server-side dedup: exact scan over stored embeddings. If a
      // near-duplicate exists, return it and reinforce it instead.
      const [docVector] = await embedDocTexts(this.embedder, [content]);
      const duplicate = await this.findNearDuplicate(docVector!);
      if (duplicate) {
        emit("dedup", { id: duplicate.id });
        const reinforced = await this.reinforceNodes([duplicate.id]);
        void reinforced;
        const [node] = await this.get([duplicate.id]);
        return node!;
      }
      this.recordAdd();
      const now = Date.now();
      const node = await this.nodeRepo.upsert({
        id: randomUUID(),
        content,
        kind: input.kind,
        importance: MEMORY_POLICY.INITIAL_IMPORTANCE,
        createdAt: now,
        lastReinforcedAt: now,
        embedding: [...docVector!],
      });
      emit("node", { id: node.id });
      this.dbChanged("add");
      return node;
    });
  }

  async update(id: string, patch: { content?: string; kind?: string }): Promise<MemoryNode> {
    return this.instrument("update", { id, ...patch }, async () => {
      const found = await this.nodeRepo.findById(id);
      if (!found) throw new Error(`update: unknown node ${id}`);
      const next: MemoryNodePatch = {};
      if (patch.kind !== undefined) {
        if (patch.kind.trim().length === 0) throw new Error("update: kind must be non-empty");
        next.kind = patch.kind;
      }
      if (patch.content !== undefined) {
        const content = patch.content.trim();
        if (content.length === 0) throw new Error("update: content must be non-empty");
        next.content = content;
        // Re-embed: the stored vector must match the new text.
        const [docVector] = await embedDocTexts(this.embedder, [content]);
        next.embedding = [...docVector!];
      }
      const updated = await this.nodeRepo.update(id, next);
      if (!updated) throw new Error(`update: unknown node ${id}`);
      this.dbChanged("update");
      return updated;
    });
  }

  async link(input: {
    from: string;
    to: string;
    relation: string;
    description: string;
  }): Promise<MemoryEdge> {
    return this.instrument("link", { ...input }, async (emit) => {
      if (input.relation.trim().length === 0) throw new Error("link: relation must be non-empty");
      if (input.description.trim().length === 0) {
        throw new Error("link: description must be non-empty");
      }
      // Upsert on (from, to, relation): reinforce instead of duplicating.
      const rows = await this.edgeRepo.list({
        table: MEMORY_EDGE_TABLE,
        fromId: input.from,
        where: { relation: input.relation },
      });
      const existing = rows.map(mapMemoryEdge).find((edge) => edge.to === input.to);
      if (existing) {
        emit("upsert", { id: existing.id });
        await this.reinforceEdges([existing.id]);
        const [edge] = (await this.edgesForIds([existing.id])) ?? [];
        return edge!;
      }
      const now = Date.now();
      const row = await this.edgeRepo.create({
        table: MEMORY_EDGE_TABLE,
        fromId: input.from,
        toId: input.to,
        props: {
          id: randomUUID(),
          relation: input.relation,
          description: input.description,
          strength: MEMORY_POLICY.INITIAL_STRENGTH,
          createdAt: now,
          lastReinforcedAt: now,
        },
      });
      const edge = mapMemoryEdge(row);
      emit("edge", { id: edge.id });
      this.dbChanged("link");
      return edge;
    });
  }

  async forget(ids: string[]): Promise<void> {
    return this.instrument("forget", { ids }, async () => {
      for (const id of [...new Set(ids)]) {
        // Cascade: drop touching edges first, both directions (the engine
        // rejects undirected DELETE, so two directed passes), then the node.
        await this.edgeRepo.remove({ table: MEMORY_EDGE_TABLE, fromId: id });
        await this.edgeRepo.remove({ table: MEMORY_EDGE_TABLE, toId: id });
        await this.nodeRepo.remove(id);
      }
      this.dbChanged("forget");
    });
  }

  // ---- REINFORCE: the ONLY way importance/strength go up ----

  async reinforceNodes(ids: string[], amount: number = MEMORY_POLICY.DEFAULT_REINFORCE_AMOUNT): Promise<void> {
    return this.instrument("reinforceNodes", { ids, amount }, async () => {
      const now = Date.now();
      for (const id of [...new Set(ids)]) {
        const node = await this.nodeRepo.findById(id);
        if (!node) continue;
        await this.nodeRepo.update(id, {
          importance: saturatingReinforce(node.importance, amount),
          lastReinforcedAt: now,
        });
      }
      this.dbChanged("reinforceNodes");
    });
  }

  async reinforceEdges(ids: string[], amount: number = MEMORY_POLICY.DEFAULT_REINFORCE_AMOUNT): Promise<void> {
    return this.instrument("reinforceEdges", { ids, amount }, async () => {
      const now = Date.now();
      for (const id of [...new Set(ids)]) {
        const [edge] = (await this.edgesForIds([id])) ?? [];
        if (!edge) continue;
        await this.edgeRepo.update(
          { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
          { strength: saturatingReinforce(edge.strength, amount), lastReinforcedAt: now },
          { id: edge.id }
        );
      }
      this.dbChanged("reinforceEdges");
    });
  }

  // ---- Server-side only: NEVER exposed to any agent ----

  async tick(): Promise<void> {
    return this.instrument("tick", {}, async () => {
      this.opsSinceTick = 0;
      await this.applyDecay();
      this.dbChanged("tick");
    });
  }

  async stats(): Promise<{
    nodes: number;
    edges: number;
    avgImportance: number;
    avgStrength: number;
    byKind: Record<string, number>;
  }> {
    const nodes = await this.nodeRepo.findAll();
    const edgeRows = await this.edgeRepo.list({ table: MEMORY_EDGE_TABLE });
    const avg = (values: number[]) =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const byKind: Record<string, number> = {};
    for (const node of nodes) byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
    return {
      nodes: nodes.length,
      edges: edgeRows.length,
      avgImportance: avg(nodes.map((node) => node.importance)),
      avgStrength: avg(edgeRows.map(mapMemoryEdge).map((edge) => edge.strength)),
      byKind,
    };
  }

  // --- internals -----------------------------------------------------------

  private async applyDecay(): Promise<void> {
    const pinned = [...MEMORY_POLICY.PINNED_KINDS];
    await this.db.query(
      `MATCH (n:${MEMORY_NODE_LABEL}) WHERE NOT (n.kind IN $pinned) SET n.importance = n.importance * $f;`,
      {
        f: MEMORY_POLICY.TICK_NODE_FACTOR,
        pinned,
      }
    );
    // Directed pattern: the undirected ()-[e]-() form trips a storage
    // assertion in the engine on bulk SET.
    await this.db.query(`MATCH ()-[e:${MEMORY_EDGE_TABLE}]->() SET e.strength = e.strength * $f;`, {
      f: MEMORY_POLICY.TICK_EDGE_FACTOR,
    });
  }

  private async edgesForIds(ids: string[]): Promise<MemoryEdge[] | null> {
    if (ids.length === 0) return [];
    const rows = await this.edgeRepo.list({ table: MEMORY_EDGE_TABLE, where: { id: ids } });
    return rows.map(mapMemoryEdge);
  }

  private async findNearDuplicate(vector: Vector): Promise<MemoryNode | null> {
    const rows = await this.db.query(
      `MATCH (n:${MEMORY_NODE_LABEL}) WHERE n.embedding IS NOT NULL RETURN n.id AS id, n.embedding AS embedding;`
    );
    let best: { id: string; score: number } | null = null;
    for (const row of rows) {
      const score = cosineSimilarity(vector, (row["embedding"] as number[]).slice());
      if (score >= MEMORY_POLICY.DEDUP_COSINE_THRESHOLD && (!best || score > best.score)) {
        best = { id: String(row["id"]), score };
      }
    }
    if (!best) return null;
    return this.nodeRepo.findById(best.id);
  }

  private checkAddBudget(): void {
    const now = Date.now();
    this.addTimes = this.addTimes.filter((at) => now - at < MEMORY_POLICY.ADD_WINDOW_MS);
    if (this.addTimes.length >= MEMORY_POLICY.MAX_ADDS_PER_WINDOW) {
      throw new Error(
        `add: budget exceeded (max ${MEMORY_POLICY.MAX_ADDS_PER_WINDOW} per ${MEMORY_POLICY.ADD_WINDOW_MS / 1000}s)`
      );
    }
  }

  private recordAdd(): void {
    this.addTimes.push(Date.now());
  }

  private instrument<T>(
    op: MemoryOpKind,
    args: Record<string, unknown>,
    run: (emit: (phase: string, detail: Record<string, unknown>) => void) => Promise<T>
  ): Promise<T> {
    const opId = randomUUID();
    const started = Date.now();
    const emit = (phase: string, detail: Record<string, unknown>) =>
      this.events.emit({ type: "step", opId, op, at: Date.now(), phase, detail });
    this.events.emit({ type: "op:start", opId, op, at: started, args });
    // Decay-first: every operation counts toward the next tick (reads
    // included — decay is driven by traffic, not just the schedule). The
    // op then runs on freshly decayed values, so a reinforce in the same
    // op always nets positive. stats() bypasses instrument() entirely, so
    // dashboard snapshots never move the values they display.
    const runAfterDecay = async (): Promise<T> => {
      if (op !== "tick") {
        this.opsSinceTick++;
        if (this.opsSinceTick >= MEMORY_POLICY.OPS_PER_TICK) {
          this.opsSinceTick = 0;
          await this.applyDecay();
          emit("decay", { every: MEMORY_POLICY.OPS_PER_TICK });
        }
      }
      return run(emit);
    };
    return runAfterDecay().then(
      (result) => {
        this.events.emit({ type: "op:end", opId, op, at: Date.now(), durationMs: Date.now() - started });
        return result;
      },
      (error: unknown) => {
        this.events.emit({
          type: "op:end",
          opId,
          op,
          at: Date.now(),
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    );
  }

  private dbChanged(reason: string): void {
    this.events.emit({ type: "db:changed", at: Date.now(), reason });
  }
}
