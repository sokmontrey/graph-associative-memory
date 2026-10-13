import { randomUUID } from "node:crypto";
import {
  MEMORY_EDGE_TABLE,
  MEMORY_EDGE_TYPES,
  MEMORY_NODE_LABEL,
  MEMORY_NODE_TYPES,
  MEMORY_STATUS_ACTIVE,
  MEMORY_STATUS_INVALIDATED,
} from "../../db/relations.ts";
import type { EdgeTableConfig } from "../../repos/edges/index.ts";
import { LadybugEdgeRepo, type EdgeRepo } from "../../repos/edges/index.ts";
import type { GraphDbRepo } from "../../repos/graphDb/index.ts";
import { LadybugNodeRepo, type NodeRepo } from "../../repos/node/index.ts";
import {
  EMBEDDING_DIMENSIONS,
  embedDocTexts,
  type TextEmbedder,
} from "../embeddings/index.ts";
import {
  MEMORY_NODE_FIELDS,
  mapMemoryEdge,
  mapMemoryNeighbor,
  mapMemoryNode,
  memoryRank,
  type MemoryEdge,
  type MemoryNode,
  type MemoryNodePatch,
  type MemoryNodeUpsert,
  type NewMemoryEdge,
  type NewMemoryNode,
} from "../../models/memory.ts";
import { HALF_LIFE, reinforceValue } from "./halfLife.ts";
import {
  DecayClock,
  exemptEdge,
  exemptNode,
  factorsForOp,
  settleEdge,
  settleNode,
  type DecayClockState,
} from "./decay/index.ts";
import type { MemorySearchProvider } from "./search/index.ts";
import type { MemoryService } from "./index.ts";

const MEMORY_EDGE_PROPS = [
  "id",
  "type",
  "description",
  "strength",
  "status",
  "last_reinforce",
  "invalidated_at",
  "invalidate_reason",
  "decay_l_strength",
] as const;

// Candidates fetched per search: relevance selects, importance/strength orders.
const SEARCH_OVERSAMPLE = 3;

function assertCount(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${what} must be a non-negative integer, got ${n}`);
  }
}

export type GraphMemoryServiceDeps = {
  db: GraphDbRepo;
  embedder: TextEmbedder;
  search: MemorySearchProvider;
  nodeRepo?: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  edgeRepo?: EdgeRepo;
};

export const MEMORY_EDGE_TABLE_CONFIG: EdgeTableConfig = {
  table: MEMORY_EDGE_TABLE,
  fromLabel: MEMORY_NODE_LABEL,
  toLabel: MEMORY_NODE_LABEL,
  props: [...MEMORY_EDGE_PROPS],
};

// Concrete MemoryService on generic Node/Edge repos. Out-edges only: every
// edge read anchors the `from` side at the queried node. Every surfacing read
// filters to `active` — invalidated rows are soft tombstones, invisible here.
//
// Salience decay is lazy: each operation advances the global DecayClock O(1)
// (see advanceForOp) and rows settle their personal backlog when surfaced
// (settle*ForRead) or mutated (settle-then-apply). See decay/ for the policy,
// log-space math, clock, and settler — this class only orchestrates them.
export class GraphMemoryService implements MemoryService {
  private readonly nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  private readonly edges: EdgeRepo;
  private readonly embedder: TextEmbedder;
  private readonly search: MemorySearchProvider;
  private readonly clock: DecayClock;

  private constructor(
    nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>,
    edges: EdgeRepo,
    embedder: TextEmbedder,
    search: MemorySearchProvider,
    clock: DecayClock
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.embedder = embedder;
    this.search = search;
    this.clock = clock;
  }

  static async create(deps: GraphMemoryServiceDeps): Promise<GraphMemoryService> {
    if (deps.embedder.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `GraphMemoryService: embedder dims ${deps.embedder.dimensions} !== schema ${EMBEDDING_DIMENSIONS} (embedding FLOAT[${EMBEDDING_DIMENSIONS}])`
      );
    }
    const nodes =
      deps.nodeRepo ??
      new LadybugNodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>(deps.db, {
        label: MEMORY_NODE_LABEL,
        fields: MEMORY_NODE_FIELDS,
        map: mapMemoryNode,
      });
    const edges = deps.edgeRepo ?? new LadybugEdgeRepo(deps.db, [MEMORY_EDGE_TABLE_CONFIG]);
    const clock = await DecayClock.load(deps.db);
    return new GraphMemoryService(nodes, edges, deps.embedder, deps.search, clock);
  }

  // --- Lazy decay ----------------------------------------------------------

  /** Current clock values (for pure projections that must not write). */
  clockSnapshot(): DecayClockState {
    return this.clock.snapshot();
  }

  /**
   * Advance the global decay clock for one operation (O(1), one write).
   * Called decay-first by the high-level instrument wrapper so every memory
   * operation — reads included — moves the clock with its own rate.
   */
  async advanceForOp(op: string): Promise<DecayClockState> {
    await this.clock.advance(factorsForOp(op));
    return this.clock.snapshot();
  }

  /**
   * Settle active nodes for surfacing: persist due backlogs, return settled
   * copies. Invalidated rows are frozen and returned untouched. No-op for rows
   * below the write threshold (their backlog keeps accumulating).
   */
  async settleNodesForRead(nodes: MemoryNode[]): Promise<MemoryNode[]> {
    const clock = this.clock.snapshot();
    return Promise.all(
      nodes.map(async (node) => {
        if (node.status !== MEMORY_STATUS_ACTIVE) return node;
        const patch = settleNode(node, clock);
        if (!patch) return node;
        return (await this.nodes.update(node.id, {
          importance: patch.importance,
          validity: patch.validity,
          decay_l_importance: patch.decay_l_importance,
          decay_l_validity: patch.decay_l_validity,
        })) ?? node;
      })
    );
  }

  async settleEdgesForRead(edges: MemoryEdge[]): Promise<MemoryEdge[]> {
    const clock = this.clock.snapshot();
    const out: MemoryEdge[] = [];
    for (const edge of edges) {
      if (edge.status !== MEMORY_STATUS_ACTIVE) {
        out.push(edge);
        continue;
      }
      const patch = settleEdge(edge, clock);
      if (!patch) {
        out.push(edge);
        continue;
      }
      const updated = await this.edges.update(
        { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
        { strength: patch.strength, decay_l_strength: patch.decay_l_strength },
        { id: edge.id }
      );
      out.push(updated[0] ? mapMemoryEdge(updated[0]) : edge);
    }
    return out;
  }

  /**
   * Pure in-memory projection (no writes) for full-graph consumers that must
   * not pay O(N) writes on a read: stats() and the dashboard snapshot.
   * Values shown are exact; watermarks catch up when rows are next settled.
   */
  projectSettledNodes(nodes: MemoryNode[]): MemoryNode[] {
    const clock = this.clock.snapshot();
    return nodes.map((node) => {
      if (node.status !== MEMORY_STATUS_ACTIVE) return node;
      const patch = settleNode(node, clock);
      if (!patch) return node;
      return {
        ...node,
        importance: patch.importance,
        validity: patch.validity,
        decay_l_importance: patch.decay_l_importance,
        decay_l_validity: patch.decay_l_validity,
      };
    });
  }

  projectSettledEdges(edges: MemoryEdge[]): MemoryEdge[] {
    const clock = this.clock.snapshot();
    return edges.map((edge) => {
      if (edge.status !== MEMORY_STATUS_ACTIVE) return edge;
      const patch = settleEdge(edge, clock);
      if (!patch) return edge;
      return { ...edge, strength: patch.strength, decay_l_strength: patch.decay_l_strength };
    });
  }

  async getTopMemories(n: number): Promise<MemoryNode[]> {
    assertCount(n, "n");
    const found = await this.nodes.findAll({
      where: { status: MEMORY_STATUS_ACTIVE },
      orderBy: "importance",
      orderDir: "DESC",
      limit: n,
    });
    // Importance is settled lazily, so stored order is slightly stale; settle
    // the page before returning it.
    return this.settleNodesForRead(found);
  }

  async getMemoryTopEdges(
    memoryId: string,
    type: MemoryEdge["type"] | null,
    n: number
  ): Promise<MemoryEdge[]> {
    assertCount(n, "n");
    const rows = await this.edges.list({
      table: MEMORY_EDGE_TABLE,
      fromId: memoryId,
      where: { status: MEMORY_STATUS_ACTIVE, ...(type ? { type } : {}) },
      orderBy: "strength",
      orderDir: "DESC",
      limit: n,
    });
    return this.settleEdgesForRead(rows.map(mapMemoryEdge));
  }

  async findMemories(keyword: string, n: number): Promise<MemoryNode[]> {
    assertCount(n, "n");
    if (n === 0) return [];
    const hits = await this.search.searchNodes(keyword, n * SEARCH_OVERSAMPLE);
    if (hits.length === 0) return [];
    const found = await this.nodes.findAll({ where: { id: hits.map((hit) => hit.id) } });
    const settled = await this.settleNodesForRead(
      found.filter((node) => node.status === MEMORY_STATUS_ACTIVE)
    );
    return settled.sort((a, b) => memoryRank(b) - memoryRank(a)).slice(0, n);
  }

  async findMemoryEdges(memoryId: string, keyword: string, n: number): Promise<MemoryEdge[]> {
    assertCount(n, "n");
    if (n === 0) return [];
    const hits = await this.search.searchEdges(memoryId, keyword, n * SEARCH_OVERSAMPLE);
    if (hits.length === 0) return [];
    const rows = await this.edges.list({
      table: MEMORY_EDGE_TABLE,
      fromId: memoryId,
      where: { id: hits.map((hit) => hit.id) },
    });
    const settled = await this.settleEdgesForRead(
      rows.map(mapMemoryEdge).filter((edge) => edge.status === MEMORY_STATUS_ACTIVE)
    );
    return settled.sort((a, b) => b.strength - a.strength).slice(0, n);
  }

  async getMemoryNeighbors(memoryId: string, edgeIds: string[]): Promise<MemoryNode[]> {
    if (edgeIds.length === 0) return [];
    const rows = await this.edges.neighbors(
      {
        table: MEMORY_EDGE_TABLE,
        fromId: memoryId,
        nodeProps: MEMORY_NODE_FIELDS,
        where: { id: edgeIds, status: MEMORY_STATUS_ACTIVE },
      },
      (row) => row
    );
    // Neighbor rows hydrate through a different alias; map then settle.
    return this.settleNodesForRead(rows.map(mapMemoryNeighbor));
  }

  async reinforceMemories(
    memoryIds: string[],
    strength: number = HALF_LIFE.REINFORCE_NODE_STRENGTH
  ): Promise<MemoryNode[]> {
    if (memoryIds.length === 0) return [];
    const clock = this.clock.snapshot();
    const ids = [...new Set(memoryIds)];
    const found = await this.nodes.findAll({ where: { id: ids } });
    const byId = new Map(found.map((node) => [node.id, node]));
    const now = new Date();
    const reinforced: MemoryNode[] = [];
    for (const id of ids) {
      const node = byId.get(id);
      if (!node) continue;
      // Settle-then-apply: the row pays its backlog first (a micro-decay when
      // the clock just advanced decay-first), then earns the bonus — net up.
      const settled = settleNode(node, clock);
      const baseImportance = settled?.importance ?? node.importance;
      const baseValidity = settled?.validity ?? node.validity;
      const updated = await this.nodes.update(id, {
        importance: reinforceValue(baseImportance, strength),
        validity: baseValidity,
        last_reinforce: now,
        decay_l_importance: clock.lImportance,
        decay_l_validity: clock.lValidity,
      });
      if (updated) reinforced.push(updated);
    }
    return reinforced;
  }

  async reinforceMemoryEdges(
    memoryId: string,
    edgeIds: string[],
    strength: number = HALF_LIFE.REINFORCE_EDGE_STRENGTH
  ): Promise<MemoryEdge[]> {
    if (edgeIds.length === 0) return [];
    const clock = this.clock.snapshot();
    const ids = [...new Set(edgeIds)];
    const rows = await this.edges.list({
      table: MEMORY_EDGE_TABLE,
      fromId: memoryId,
      where: { id: ids },
    });
    const byId = new Map(rows.map(mapMemoryEdge).map((edge) => [edge.id, edge]));
    const now = new Date();
    const reinforced: MemoryEdge[] = [];
    for (const id of ids) {
      const edge = byId.get(id);
      if (!edge) continue;
      const settled = settleEdge(edge, clock);
      const base = settled?.strength ?? edge.strength;
      const updated = await this.edges.update(
        { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
        {
          strength: reinforceValue(base, strength),
          last_reinforce: now,
          decay_l_strength: clock.lStrength,
        },
        { id: edge.id }
      );
      if (updated[0]) reinforced.push(mapMemoryEdge(updated[0]));
    }
    return reinforced;
  }

  async invalidateMemory(
    memoryId: string,
    reason: string,
    supersededBy: string | null = null
  ): Promise<MemoryNode> {
    const clock = this.clock.snapshot();
    const updated = await this.nodes.update(memoryId, {
      status: MEMORY_STATUS_INVALIDATED,
      validity: 0,
      invalidated_at: new Date(),
      invalidate_reason: reason,
      // Freeze the watermark: the tombstone gap is forgiven, so a later
      // reinstate doesn't owe decay for time spent invalidated.
      ...exemptNode(clock),
      ...(supersededBy !== null ? { superseded_by: supersededBy } : {}),
    });
    if (!updated) throw new Error(`invalidateMemory: unknown memory ${memoryId}`);
    return updated;
  }

  async invalidateMemoryEdge(edgeId: string, reason: string): Promise<MemoryEdge | null> {
    const rows = await this.edges.list({ table: MEMORY_EDGE_TABLE, where: { id: edgeId } });
    const edge = rows.map(mapMemoryEdge)[0];
    if (!edge) return null;
    const clock = this.clock.snapshot();
    const updated = await this.edges.update(
      { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
      {
        status: MEMORY_STATUS_INVALIDATED,
        invalidated_at: new Date(),
        invalidate_reason: reason,
        ...exemptEdge(clock),
      },
      { id: edge.id }
    );
    return updated[0] ? mapMemoryEdge(updated[0]) : null;
  }

  async reinstateMemory(
    memoryId: string,
    validity: number = HALF_LIFE.INITIAL_VALIDITY
  ): Promise<MemoryNode | null> {
    const clock = this.clock.snapshot();
    return this.nodes.update(memoryId, {
      status: MEMORY_STATUS_ACTIVE,
      validity,
      invalidated_at: null,
      invalidate_reason: null,
      superseded_by: null,
      ...exemptNode(clock),
    });
  }

  async reinstateMemoryEdge(edgeId: string): Promise<MemoryEdge | null> {
    const rows = await this.edges.list({ table: MEMORY_EDGE_TABLE, where: { id: edgeId } });
    const edge = rows.map(mapMemoryEdge)[0];
    if (!edge) return null;
    const clock = this.clock.snapshot();
    const updated = await this.edges.update(
      { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
      {
        status: MEMORY_STATUS_ACTIVE,
        invalidated_at: null,
        invalidate_reason: null,
        ...exemptEdge(clock),
      },
      { id: edge.id }
    );
    return updated[0] ? mapMemoryEdge(updated[0]) : null;
  }

  async setMemoryValidity(memoryId: string, validity: number): Promise<MemoryNode | null> {
    if (!Number.isFinite(validity)) {
      throw new Error(`setMemoryValidity: validity must be finite, got ${validity}`);
    }
    // Settle-then-write so a computed validity (challenge/corroborate) applies
    // to a fresh value and the write leaves no lingering backlog.
    const clock = this.clock.snapshot();
    const current = await this.nodes.findById(memoryId);
    if (!current) return null;
    const settled = settleNode(current, clock);
    return this.nodes.update(memoryId, {
      validity,
      importance: settled?.importance ?? current.importance,
      decay_l_importance: clock.lImportance,
      decay_l_validity: clock.lValidity,
    });
  }

  async addMemory(node: NewMemoryNode): Promise<MemoryNode> {
    if (!(MEMORY_NODE_TYPES as readonly string[]).includes(node.type)) {
      throw new Error(`addMemory: unknown type ${JSON.stringify(node.type)}`);
    }
    const [docVector] = await embedDocTexts(this.embedder, [node.description]);
    const clock = this.clock.snapshot();
    return this.nodes.upsert({
      id: randomUUID(),
      type: node.type,
      description: node.description,
      importance: HALF_LIFE.INITIAL_IMPORTANCE,
      validity: HALF_LIFE.INITIAL_VALIDITY,
      status: MEMORY_STATUS_ACTIVE,
      last_reinforce: new Date(),
      invalidated_at: null,
      invalidate_reason: null,
      superseded_by: null,
      // Born current: no back-decay owed.
      decay_l_importance: clock.lImportance,
      decay_l_validity: clock.lValidity,
      embedding: [...docVector!],
    });
  }

  async addEdge(edge: NewMemoryEdge): Promise<MemoryEdge> {
    if (!(MEMORY_EDGE_TYPES as readonly string[]).includes(edge.type)) {
      throw new Error(`addEdge: unknown type ${JSON.stringify(edge.type)}`);
    }
    const clock = this.clock.snapshot();
    const row = await this.edges.create({
      table: MEMORY_EDGE_TABLE,
      fromId: edge.from,
      toId: edge.to,
      props: {
        id: randomUUID(),
        type: edge.type,
        description: edge.description,
        strength: HALF_LIFE.INITIAL_STRENGTH,
        status: MEMORY_STATUS_ACTIVE,
        last_reinforce: new Date(),
        invalidated_at: null,
        invalidate_reason: null,
        decay_l_strength: clock.lStrength,
      },
    });
    return mapMemoryEdge(row);
  }

  /**
   * Manual big hammer (dashboard tick button): advance the clock by the legacy
   * bulk factors. Lazy — O(1), no row scan. Rows settle on their next read or
   * mutation; full-graph views project settled values without writing.
   */
  async tick(): Promise<void> {
    await this.clock.advance(factorsForOp("tick"));
  }
}
