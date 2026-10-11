import { randomUUID } from "node:crypto";
import {
  MEMORY_EDGE_TABLE,
  MEMORY_NODE_LABEL,
  MEMORY_STATUS_ACTIVE,
} from "../../db/relations.ts";
import {
  MEMORY_NODE_FIELDS,
  mapMemoryEdge,
  mapMemoryNode,
  memoryRank,
  type MemoryEdge,
  type MemoryNode,
  type MemoryNodePatch,
  type MemoryNodeType,
  type MemoryNodeUpsert,
  type NewMemoryEdge,
} from "../../models/memory.ts";
import { LadybugEdgeRepo, type EdgeRepo } from "../../repos/edges/index.ts";
import type { GraphDbRepo } from "../../repos/graphDb/index.ts";
import { LadybugNodeRepo, type NodeRepo } from "../../repos/node/index.ts";
import {
  cosineSimilarity,
  embedDocTexts,
  embedQueryText,
  type TextEmbedder,
  type Vector,
} from "../embeddings/index.ts";
import {
  GraphMemoryService,
  MEMORY_EDGE_TABLE_CONFIG,
} from "../graphMemory/graphMemoryService.ts";
import {
  challengeValidity,
  corroborateValidity,
  HALF_LIFE,
} from "../graphMemory/halfLife.ts";
import type { MemoryService } from "../graphMemory/index.ts";
import type { MemorySearchProvider } from "../graphMemory/search/index.ts";
import type {
  ContradictionResolution,
  HighlevelMemoryService as HighlevelMemoryServiceContract,
  InvalidationResult,
  InvalidationTarget,
  LinkProposal,
  MemoryInspection,
  MemoryLink,
  MemoryStats,
  MemoryTypeFilter,
  ProposeLinksOptions,
  RecallResult,
  RecallStep,
  RememberLink,
} from "./index.ts";
import { NOOP_MEMORY_EVENTS, type MemoryEventBus, type MemoryOpKind } from "./events.ts";
import { JevLinkGrounder } from "./jevLinkGrounder.ts";
import type { LinkGrounder } from "./linkGrounder.ts";

// Candidates fetched per semantic search: relevance selects, importance orders.
const SEARCH_OVERSAMPLE = 3;
// In-memory active buffer: newest remembers and the last recall's nodes.
const RECENT_REMEMBERED = 10;
const BUFFER_SIZE = 20;
// Associative recall: how far and how wide the greedy walk explores.
const ANCHOR_COUNT = 3;
const GOAL_COUNT = 3;
const RECALL_MAX_HOPS = 6;
const RECALL_FANOUT = 5;
// Candidate pairs evaluated per proposeLinks call when no limit is given.
const DEFAULT_PROPOSAL_LIMIT = 20;
// Semantic neighbors pulled in around an explicit proposeLinks focus.
const FOCUS_NEIGHBORS = 8;

type Neighbor = { node: MemoryNode; edge: MemoryEdge };

function assertCount(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${what} must be a non-negative integer, got ${n}`);
  }
}

function dedupeNodes(nodes: MemoryNode[]): MemoryNode[] {
  const seen = new Set<string>();
  const out: MemoryNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

export type HighlevelMemoryServiceDeps = {
  db: GraphDbRepo;
  embedder: TextEmbedder;
  search: MemorySearchProvider;
  /** Grounded model for proposeLinks. Defaults to JevLinkGrounder. */
  grounder?: LinkGrounder;
  /** Instrumentation sink for the dashboard. Defaults to a no-op bus. */
  events?: MemoryEventBus;
  nodeRepo?: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  edgeRepo?: EdgeRepo;
};

// Concrete HighlevelMemoryService. Composes the low-level MemoryService for
// CRUD/reinforce, a NodeRepo for type-filtered ranking, and a LinkGrounder for
// the grounded proposeLinks. The active buffer (recent remembers + last recall)
// lives in memory for the life of the instance.
export class HighlevelMemoryService implements HighlevelMemoryServiceContract {
  private readonly memory: MemoryService;
  private readonly nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  private readonly edges: EdgeRepo;
  private readonly embedder: TextEmbedder;
  private readonly search: MemorySearchProvider;
  private readonly grounder: LinkGrounder;
  private readonly events: MemoryEventBus;

  private recentRemembered: string[] = [];
  private lastRecallIds: string[] = [];

  private constructor(
    memory: MemoryService,
    nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>,
    edges: EdgeRepo,
    embedder: TextEmbedder,
    search: MemorySearchProvider,
    grounder: LinkGrounder,
    events: MemoryEventBus
  ) {
    this.memory = memory;
    this.nodes = nodes;
    this.edges = edges;
    this.embedder = embedder;
    this.search = search;
    this.grounder = grounder;
    this.events = events;
  }

  static async create(deps: HighlevelMemoryServiceDeps): Promise<HighlevelMemoryService> {
    const nodes =
      deps.nodeRepo ??
      new LadybugNodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>(deps.db, {
        label: MEMORY_NODE_LABEL,
        fields: MEMORY_NODE_FIELDS,
        map: mapMemoryNode,
      });
    const edges = deps.edgeRepo ?? new LadybugEdgeRepo(deps.db, [MEMORY_EDGE_TABLE_CONFIG]);
    const memory = await GraphMemoryService.create({
      db: deps.db,
      embedder: deps.embedder,
      search: deps.search,
      nodeRepo: nodes,
      edgeRepo: edges,
    });
    const grounder = deps.grounder ?? JevLinkGrounder.create();
    const events = deps.events ?? NOOP_MEMORY_EVENTS;
    return new HighlevelMemoryService(
      memory,
      nodes,
      edges,
      deps.embedder,
      deps.search,
      grounder,
      events
    );
  }

  async getTopImportance(
    type: MemoryTypeFilter,
    n: number,
    semanticQuery?: string
  ): Promise<MemoryNode[]> {
    return this.instrument(
      "getTopImportance",
      { type, n, semanticQuery: semanticQuery ?? null },
      async (emit) => {
        assertCount(n, "n");
        if (n === 0) return [];
        const matches = (node: MemoryNode) =>
          node.status === MEMORY_STATUS_ACTIVE && (type === "all" || node.type === type);
        let pool: MemoryNode[];
        if (semanticQuery === undefined) {
          pool = await this.nodes.findAll({ where: { status: MEMORY_STATUS_ACTIVE } });
        } else {
          const hits = await this.search.searchNodes(semanticQuery, n * SEARCH_OVERSAMPLE);
          emit("search", { query: semanticQuery, hits: hits.length });
          if (hits.length === 0) return [];
          pool = await this.nodes.findAll({ where: { id: hits.map((hit) => hit.id) } });
        }
        const ranked = pool
          .filter(matches)
          .sort((a, b) => memoryRank(b) - memoryRank(a))
          .slice(0, n);
        emit("rank", { ids: ranked.map((node) => node.id) });
        return ranked;
      },
      (result) => result.map((node) => node.id)
    );
  }

  async recall(
    initialIdea: string,
    goalIdea: string,
    searchHints: string[] = []
  ): Promise<RecallResult> {
    return this.instrument(
      "recall",
      { initialIdea, goalIdea, searchHints },
      async (emit) => {
        emit("embed", { initial: initialIdea, goal: goalIdea, hints: searchHints });
        const goalVector = await embedQueryText(this.embedder, goalIdea);
        const hintVectors = await Promise.all(
          searchHints.map((hint) => embedQueryText(this.embedder, hint))
        );
        const anchors = await this.searchNodes(initialIdea, ANCHOR_COUNT);
        emit("anchors", { query: initialIdea, ids: anchors.map((node) => node.id) });
        const goals = await this.searchNodes(goalIdea, GOAL_COUNT);
        emit("goals", { query: goalIdea, ids: goals.map((node) => node.id) });
        const goalIds = new Set(goals.map((node) => node.id));

        let best: { steps: RecallStep[]; score: number; reachedGoal: boolean } = {
          steps: [],
          score: -Infinity,
          reachedGoal: false,
        };
        for (const anchor of anchors) {
          const walk = await this.walk(anchor, goalVector, hintVectors, goalIds, emit);
          if (walk.score > best.score) best = walk;
          if (walk.reachedGoal) break;
        }

        const path = best.steps;
        for (const step of path) {
          await this.memory.reinforceMemoryEdges(step.fromId, [step.edge.id]);
          emit("reinforce", { edgeId: step.edge.id, fromId: step.fromId });
        }

        this.lastRecallIds = [
          ...new Set([
            ...anchors.map((node) => node.id),
            ...path.map((step) => step.to.id),
            ...goals.map((node) => node.id),
          ]),
        ];
        if (path.length > 0) this.dbChanged("recall");
        return { anchors, path, goals };
      },
      (result) => ({
        anchors: result.anchors.length,
        pathLength: result.path.length,
        goals: result.goals.length,
      })
    );
  }

  async remember(
    type: MemoryNodeType,
    description: string,
    links: RememberLink[]
  ): Promise<{ node: MemoryNode; edges: MemoryEdge[] }> {
    return this.instrument(
      "remember",
      { type, description, links: links.length },
      async (emit) => {
        const node = await this.memory.addMemory({ type, description });
        emit("node", { id: node.id, type: node.type, description: node.description });
        this.pushRecent(node.id);
        const edges: MemoryEdge[] = [];
        for (const link of links) {
          const from = link.direction === "out" ? node.id : link.otherNodeId;
          const to = link.direction === "out" ? link.otherNodeId : node.id;
          const edge = await this.memory.addEdge(
            this.toNewEdge(from, to, link.edgeType, link.description)
          );
          emit("edge", { edgeId: edge.id, fromId: edge.from, toId: edge.to, edgeType: edge.type });
          edges.push(edge);
        }
        this.dbChanged("remember");
        return { node, edges };
      },
      (result) => ({ nodeId: result.node.id, edgeIds: result.edges.map((edge) => edge.id) })
    );
  }

  async proposeLinks(options: ProposeLinksOptions = {}): Promise<LinkProposal[]> {
    return this.instrument(
      "proposeLinks",
      { focusId: options.focusId ?? null, limit: options.limit ?? null },
      async (emit) => {
        const candidates = await this.proposeCandidates(options);
        const pairs = await this.candidatePairs(
          candidates,
          options.limit ?? DEFAULT_PROPOSAL_LIMIT
        );
        emit("candidates", {
          ids: candidates.map((node) => node.id),
          pairs: pairs.map(([a, b]) => [a.id, b.id]),
        });

        const grounded = await Promise.all(
          pairs.map(async ([a, b]) => {
            const link = await this.grounder.ground(a, b);
            if (link) {
              emit("ground", {
                fromId: link.fromId,
                toId: link.toId,
                edgeType: link.edgeType,
                confidence: link.confidence,
                favoredId: link.favoredId ?? null,
              });
            }
            return link;
          })
        );

        const proposals: LinkProposal[] = [];
        for (let i = 0; i < pairs.length; i++) {
          const link = grounded[i];
          if (!link) continue;
          const [a, b] = pairs[i]!;
          const byId = new Map<string, MemoryNode>([
            [a.id, a],
            [b.id, b],
          ]);
          const from = byId.get(link.fromId);
          const to = byId.get(link.toId);
          if (!from || !to) continue;
          const proposal: LinkProposal = {
            link: { fromId: link.fromId, toId: link.toId, edgeType: link.edgeType },
            confidence: link.confidence,
            evidence: link.evidence,
            nodes: { from, to },
          };
          if (link.edgeType === "contradicts" && link.favoredId !== undefined) {
            proposal.contradiction = {
              favoredId: link.favoredId,
              confidence: link.evidence["conflict"] ?? link.confidence,
            };
          }
          proposals.push(proposal);
        }
        return proposals;
      },
      (result) => ({ count: result.length })
    );
  }

  async connect(link: MemoryLink): Promise<MemoryEdge> {
    return this.instrument(
      "connect",
      { fromId: link.fromId, toId: link.toId, edgeType: link.edgeType },
      async (emit) => {
        const edge = await this.memory.addEdge(
          this.toNewEdge(link.fromId, link.toId, link.edgeType, link.description)
        );
        emit("edge", { edgeId: edge.id, fromId: edge.from, toId: edge.to, edgeType: edge.type });
        this.dbChanged("connect");
        return edge;
      },
      (edge) => edge.id
    );
  }

  async invalidate(
    target: InvalidationTarget,
    reason: string,
    supersededBy?: string
  ): Promise<InvalidationResult> {
    return this.instrument(
      "invalidate",
      { target, reason, supersededBy: supersededBy ?? null },
      async (emit) => {
        if ("nodeId" in target) {
          const node = await this.memory.invalidateMemory(target.nodeId, reason, supersededBy ?? null);
          emit("invalidated", {
            kind: "node",
            id: node.id,
            reason,
            supersededBy: supersededBy ?? null,
          });
          this.dbChanged("invalidate");
          return { kind: "node", node } satisfies InvalidationResult;
        }
        const edge = await this.memory.invalidateMemoryEdge(target.edgeId, reason);
        if (!edge) throw new Error(`invalidate: unknown edge ${target.edgeId}`);
        emit("invalidated", { kind: "edge", id: edge.id, reason });
        this.dbChanged("invalidate");
        return { kind: "edge", edge } satisfies InvalidationResult;
      },
      (result) => ({ kind: result.kind })
    );
  }

  async reinstate(target: InvalidationTarget, reason?: string): Promise<InvalidationResult> {
    return this.instrument(
      "reinstate",
      { target, reason: reason ?? null },
      async (emit) => {
        if ("nodeId" in target) {
          const node = await this.memory.reinstateMemory(target.nodeId);
          if (!node) throw new Error(`reinstate: unknown memory ${target.nodeId}`);
          emit("reinstated", { kind: "node", id: node.id, reason: reason ?? null });
          this.dbChanged("reinstate");
          return { kind: "node", node } satisfies InvalidationResult;
        }
        const edge = await this.memory.reinstateMemoryEdge(target.edgeId);
        if (!edge) throw new Error(`reinstate: unknown edge ${target.edgeId}`);
        emit("reinstated", { kind: "edge", id: edge.id, reason: reason ?? null });
        this.dbChanged("reinstate");
        return { kind: "edge", edge } satisfies InvalidationResult;
      },
      (result) => ({ kind: result.kind })
    );
  }

  async resolveContradiction(
    keepId: string,
    dropId: string,
    rationale: string,
    evidence?: Record<string, number>
  ): Promise<ContradictionResolution> {
    return this.instrument(
      "resolveContradiction",
      { keepId, dropId, rationale },
      async (emit) => {
        const keepBefore = await this.nodes.findById(keepId);
        if (!keepBefore) throw new Error(`resolveContradiction: unknown keep memory ${keepId}`);
        const dropBefore = await this.nodes.findById(dropId);
        if (!dropBefore) throw new Error(`resolveContradiction: unknown drop memory ${dropId}`);

        // Winner: more salient (reinforced) and more believed (corroborated).
        const reinforced = (await this.memory.reinforceMemories([keepId]))[0] ?? keepBefore;
        emit("reinforce", { keepId, importance: reinforced.importance });
        const keepValidity = corroborateValidity(reinforced.validity);
        const kept = (await this.memory.setMemoryValidity(keepId, keepValidity)) ?? reinforced;
        emit("validity", { id: keepId, from: reinforced.validity, to: keepValidity });

        // Loser: decisive soft tombstone, superseded by the winner.
        const dropped = await this.memory.invalidateMemory(dropId, rationale, keepId);
        emit("invalidated", { kind: "node", id: dropId, reason: rationale, supersededBy: keepId });

        const edge = await this.ensureContradictsEdge(keepId, dropId, rationale, evidence);
        emit("linked", { edgeId: edge.id, fromId: edge.from, toId: edge.to, edgeType: edge.type });
        this.dbChanged("resolveContradiction");
        return { kept, dropped, edge };
      },
      (result) => ({
        keptId: result.kept.id,
        droppedId: result.dropped.id,
        edgeId: result.edge.id,
      })
    );
  }

  async challenge(memoryId: string, reason: string): Promise<MemoryNode> {
    return this.instrument("challenge", { memoryId, reason }, async (emit) => {
      const before = await this.nodes.findById(memoryId);
      if (!before) throw new Error(`challenge: unknown memory ${memoryId}`);
      const to = challengeValidity(before.validity);
      const updated = (await this.memory.setMemoryValidity(memoryId, to)) ?? before;
      emit("validity", { id: memoryId, from: before.validity, to, reason });
      this.dbChanged("challenge");
      return updated;
    }, (node) => ({ id: node.id, validity: node.validity }));
  }

  async corroborate(memoryId: string, reason?: string): Promise<MemoryNode> {
    return this.instrument(
      "corroborate",
      { memoryId, reason: reason ?? null },
      async (emit) => {
        const before = await this.nodes.findById(memoryId);
        if (!before) throw new Error(`corroborate: unknown memory ${memoryId}`);
        const to = corroborateValidity(before.validity);
        await this.memory.setMemoryValidity(memoryId, to);
        const updated = (await this.memory.reinforceMemories([memoryId]))[0] ?? before;
        emit("validity", { id: memoryId, from: before.validity, to, reason: reason ?? null });
        this.dbChanged("corroborate");
        return updated;
      },
      (node) => ({ id: node.id, validity: node.validity, importance: node.importance })
    );
  }

  async reinforce(memoryId: string, strength?: number): Promise<MemoryNode> {
    return this.instrument(
      "reinforce",
      { memoryId, strength: strength ?? null },
      async (emit) => {
        const updated = (await this.memory.reinforceMemories([memoryId], strength))[0];
        if (!updated) throw new Error(`reinforce: unknown memory ${memoryId}`);
        emit("reinforced", { id: updated.id, importance: updated.importance });
        this.dbChanged("reinforce");
        return updated;
      },
      (node) => ({ id: node.id, importance: node.importance })
    );
  }

  async setValidity(memoryId: string, validity: number): Promise<MemoryNode> {
    if (!Number.isFinite(validity)) {
      throw new Error(`setValidity: validity must be finite, got ${validity}`);
    }
    const clamped = Math.min(HALF_LIFE.MAX, Math.max(HALF_LIFE.VALIDITY_FLOOR, validity));
    const updated = await this.memory.setMemoryValidity(memoryId, clamped);
    if (!updated) throw new Error(`setValidity: unknown memory ${memoryId}`);
    this.dbChanged("setValidity");
    return updated;
  }

  async inspect(memoryId: string): Promise<MemoryInspection> {
    const node = await this.nodes.findById(memoryId);
    if (!node) return { node: null, outEdges: [], inEdges: [], neighbors: [] };
    const outEdges = (await this.edges.list({ table: MEMORY_EDGE_TABLE, fromId: memoryId })).map(
      mapMemoryEdge
    );
    const inEdges = (await this.edges.list({ table: MEMORY_EDGE_TABLE, toId: memoryId })).map(
      mapMemoryEdge
    );
    const neighborIds = [
      ...new Set([...outEdges.map((edge) => edge.to), ...inEdges.map((edge) => edge.from)]),
    ];
    const neighbors = neighborIds.length
      ? await this.nodes.findAll({ where: { id: neighborIds } })
      : [];
    return { node, outEdges, inEdges, neighbors };
  }

  async stats(): Promise<MemoryStats> {
    const nodes = await this.nodes.findAll();
    const edges = (await this.edges.list({ table: MEMORY_EDGE_TABLE })).map(mapMemoryEdge);
    const activeNodes = nodes.filter((node) => node.status === MEMORY_STATUS_ACTIVE);
    const activeEdges = edges.filter((edge) => edge.status === MEMORY_STATUS_ACTIVE);
    const avg = (values: number[]) =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const byNodeType: Record<MemoryNodeType, number> = { preference: 0, trait: 0, observation: 0 };
    for (const node of nodes) byNodeType[node.type] += 1;
    const byEdgeType: Record<MemoryEdge["type"], number> = {
      supports: 0,
      contradicts: 0,
      related_to: 0,
      evokes: 0,
    };
    for (const edge of edges) byEdgeType[edge.type] += 1;
    return {
      nodes: {
        total: nodes.length,
        active: activeNodes.length,
        invalidated: nodes.length - activeNodes.length,
        avgImportance: avg(activeNodes.map((node) => node.importance)),
        avgValidity: avg(activeNodes.map((node) => node.validity)),
      },
      edges: {
        total: edges.length,
        active: activeEdges.length,
        invalidated: edges.length - activeEdges.length,
        avgStrength: avg(activeEdges.map((edge) => edge.strength)),
      },
      byNodeType,
      byEdgeType,
    };
  }

  // --- internals -----------------------------------------------------------

  private instrument<T>(
    op: MemoryOpKind,
    args: Record<string, unknown>,
    run: (emit: (phase: string, detail: Record<string, unknown>) => void) => Promise<T>,
    summarize?: (result: T) => unknown
  ): Promise<T> {
    const opId = randomUUID();
    const started = Date.now();
    const emit = (phase: string, detail: Record<string, unknown>) =>
      this.events.emit({ type: "step", opId, op, at: Date.now(), phase, detail });
    this.events.emit({ type: "op:start", opId, op, at: started, args });
    return run(emit).then(
      (result) => {
        this.events.emit({
          type: "op:end",
          opId,
          op,
          at: Date.now(),
          durationMs: Date.now() - started,
          result: summarize ? summarize(result) : undefined,
        });
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

  private toNewEdge(
    from: string,
    to: string,
    type: MemoryEdge["type"],
    description: string
  ): NewMemoryEdge {
    // The union of per-kind Omit types can't be built from the bare union of
    // its `type` literals; the shape is identical across kinds.
    return { from, to, type, description } as NewMemoryEdge;
  }

  private pushRecent(id: string): void {
    this.recentRemembered = [id, ...this.recentRemembered.filter((known) => known !== id)].slice(
      0,
      RECENT_REMEMBERED
    );
  }

  private async activeBufferNodes(): Promise<MemoryNode[]> {
    const ids = [
      ...new Set([...this.recentRemembered, ...this.lastRecallIds]),
    ].slice(0, BUFFER_SIZE);
    if (ids.length === 0) return [];
    const found = await this.nodes.findAll({ where: { id: ids } });
    return found.filter((node) => node.status === MEMORY_STATUS_ACTIVE);
  }

  // Candidate memories for proposeLinks. Given a focusId, the focus plus the
  // active buffer plus the focus's semantic neighbors — so a focus works even
  // when the (in-memory, session-scoped) buffer is empty. Without a focus, the
  // buffer, or the most salient active memories when the buffer is too small.
  private async proposeCandidates(options: ProposeLinksOptions): Promise<MemoryNode[]> {
    const buffer = await this.activeBufferNodes();
    if (options.focusId !== undefined) {
      const focus = await this.nodes.findById(options.focusId);
      if (!focus || focus.status !== MEMORY_STATUS_ACTIVE) {
        throw new Error(`proposeLinks: unknown or inactive focus ${options.focusId}`);
      }
      const nearby = await this.searchNodes(focus.description, FOCUS_NEIGHBORS);
      return dedupeNodes([focus, ...buffer, ...nearby]);
    }
    if (buffer.length >= 2) return buffer;
    const active = await this.nodes.findAll({ where: { status: MEMORY_STATUS_ACTIVE } });
    return active.sort((a, b) => memoryRank(b) - memoryRank(a)).slice(0, BUFFER_SIZE);
  }

  private async searchNodes(query: string, limit: number): Promise<MemoryNode[]> {
    const hits = await this.search.searchNodes(query, limit);
    if (hits.length === 0) return [];
    const found = await this.nodes.findAll({ where: { id: hits.map((hit) => hit.id) } });
    const byId = new Map(found.map((node) => [node.id, node]));
    return hits
      .map((hit) => byId.get(hit.id))
      .filter((node): node is MemoryNode => node !== undefined)
      .filter((node) => node.status === MEMORY_STATUS_ACTIVE)
      .slice(0, limit);
  }

  // One greedy step: the out-edge whose neighbor best matches the goal or a
  // hint, skipping already-visited nodes and doubt-scaled neighbors.
  private async bestStep(
    current: MemoryNode,
    goalVector: Vector,
    hintVectors: Vector[],
    visited: Set<string>
  ): Promise<{ step: RecallStep; score: number } | null> {
    const edges = await this.memory.getMemoryTopEdges(current.id, null, RECALL_FANOUT);
    if (edges.length === 0) return null;
    const found = await this.nodes.findAll({
      where: { id: [...new Set(edges.map((edge) => edge.to))] },
    });
    const byId = new Map(found.map((node) => [node.id, node]));
    const fresh: Neighbor[] = [];
    const seen = new Set<string>();
    for (const edge of edges) {
      const node = byId.get(edge.to);
      if (!node || node.status !== MEMORY_STATUS_ACTIVE) continue;
      if (visited.has(node.id) || seen.has(node.id)) continue;
      seen.add(node.id);
      fresh.push({ node, edge });
    }
    if (fresh.length === 0) return null;

    const vectors = await embedDocTexts(
      this.embedder,
      fresh.map((neighbor) => neighbor.node.description)
    );
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < fresh.length; i++) {
      const neighbor = fresh[i]!;
      const vector = vectors[i]!;
      const goalScore = cosineSimilarity(vector, goalVector);
      const hintScore =
        hintVectors.length === 0
          ? -Infinity
          : Math.max(...hintVectors.map((hint) => cosineSimilarity(vector, hint)));
      // Doubt scales attraction: a low-validity memory pulls less.
      const score = Math.max(goalScore, hintScore) * neighbor.node.validity;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return null;
    const chosen = fresh[bestIndex]!;
    return { step: { fromId: current.id, edge: chosen.edge, to: chosen.node }, score: bestScore };
  }

  private async walk(
    anchor: MemoryNode,
    goalVector: Vector,
    hintVectors: Vector[],
    goalIds: Set<string>,
    emit: (phase: string, detail: Record<string, unknown>) => void
  ): Promise<{ steps: RecallStep[]; score: number; reachedGoal: boolean }> {
    const steps: RecallStep[] = [];
    const visited = new Set<string>([anchor.id]);
    let current = anchor;
    let bestScore = 0;
    let reachedGoal = goalIds.has(current.id);
    for (let hop = 0; hop < RECALL_MAX_HOPS && !reachedGoal; hop++) {
      const next = await this.bestStep(current, goalVector, hintVectors, visited);
      if (!next) break;
      steps.push(next.step);
      visited.add(next.step.to.id);
      current = next.step.to;
      bestScore = Math.max(bestScore, next.score);
      emit("hop", {
        hop: hop + 1,
        fromId: next.step.fromId,
        edgeId: next.step.edge.id,
        toId: next.step.to.id,
        score: next.score,
      });
      if (goalIds.has(current.id)) reachedGoal = true;
    }
    return { steps, score: reachedGoal ? 2 + bestScore : bestScore, reachedGoal };
  }

  private async candidatePairs(
    nodes: MemoryNode[],
    limit: number
  ): Promise<Array<[MemoryNode, MemoryNode]>> {
    assertCount(limit, "limit");
    if (limit === 0 || nodes.length < 2) return [];
    const existing = await this.existingLinkKeys(nodes.map((node) => node.id));
    const pairs: Array<[MemoryNode, MemoryNode]> = [];
    for (let i = 0; i < nodes.length && pairs.length < limit; i++) {
      for (let j = i + 1; j < nodes.length && pairs.length < limit; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        if (existing.has(`${a.id}\u0000${b.id}`) || existing.has(`${b.id}\u0000${a.id}`)) {
          continue;
        }
        pairs.push([a, b]);
      }
    }
    return pairs;
  }

  // Directed keys of *active* edges already inside the candidate set, so
  // proposeLinks never re-proposes a live link (invalidated ones don't block).
  private async existingLinkKeys(ids: string[]): Promise<Set<string>> {
    const idSet = new Set(ids);
    const keys = new Set<string>();
    for (const id of idSet) {
      const rows = await this.edges.list({
        table: MEMORY_EDGE_TABLE,
        fromId: id,
        where: { status: MEMORY_STATUS_ACTIVE },
      });
      for (const row of rows) {
        const edge = mapMemoryEdge(row);
        if (idSet.has(edge.to)) keys.add(`${edge.from}\u0000${edge.to}`);
      }
    }
    return keys;
  }

  // Reuse an active `contradicts` edge between the two memories, else record one
  // carrying the rationale (and any evidence) as its description.
  private async ensureContradictsEdge(
    keepId: string,
    dropId: string,
    rationale: string,
    evidence?: Record<string, number>
  ): Promise<MemoryEdge> {
    for (const [fromId, toId] of [
      [keepId, dropId],
      [dropId, keepId],
    ] as const) {
      const rows = await this.edges.list({
        table: MEMORY_EDGE_TABLE,
        fromId,
        where: { status: MEMORY_STATUS_ACTIVE },
      });
      const existing = rows
        .map(mapMemoryEdge)
        .find((edge) => edge.type === "contradicts" && edge.to === toId);
      if (existing) return existing;
    }
    const description = evidence
      ? `${rationale} (evidence ${JSON.stringify(evidence)})`
      : rationale;
    return this.memory.addEdge(this.toNewEdge(keepId, dropId, "contradicts", description));
  }
}
