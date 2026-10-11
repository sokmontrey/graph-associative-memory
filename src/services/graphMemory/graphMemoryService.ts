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
import { HALF_LIFE, decayValue, decayValidity, reinforceValue } from "./halfLife.ts";
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
export class GraphMemoryService implements MemoryService {
  private readonly nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  private readonly edges: EdgeRepo;
  private readonly embedder: TextEmbedder;
  private readonly search: MemorySearchProvider;

  private constructor(
    nodes: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>,
    edges: EdgeRepo,
    embedder: TextEmbedder,
    search: MemorySearchProvider
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.embedder = embedder;
    this.search = search;
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
    return new GraphMemoryService(nodes, edges, deps.embedder, deps.search);
  }

  async getTopMemories(n: number): Promise<MemoryNode[]> {
    assertCount(n, "n");
    return this.nodes.findAll({
      where: { status: MEMORY_STATUS_ACTIVE },
      orderBy: "importance",
      orderDir: "DESC",
      limit: n,
    });
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
    return rows.map(mapMemoryEdge);
  }

  async findMemories(keyword: string, n: number): Promise<MemoryNode[]> {
    assertCount(n, "n");
    if (n === 0) return [];
    const hits = await this.search.searchNodes(keyword, n * SEARCH_OVERSAMPLE);
    if (hits.length === 0) return [];
    const found = await this.nodes.findAll({ where: { id: hits.map((hit) => hit.id) } });
    return found
      .filter((node) => node.status === MEMORY_STATUS_ACTIVE)
      .sort((a, b) => memoryRank(b) - memoryRank(a))
      .slice(0, n);
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
    return rows
      .map(mapMemoryEdge)
      .filter((edge) => edge.status === MEMORY_STATUS_ACTIVE)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, n);
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
    return rows.map(mapMemoryNeighbor);
  }

  async reinforceMemories(
    memoryIds: string[],
    strength: number = HALF_LIFE.REINFORCE_NODE_STRENGTH
  ): Promise<MemoryNode[]> {
    if (memoryIds.length === 0) return [];
    const ids = [...new Set(memoryIds)];
    const found = await this.nodes.findAll({ where: { id: ids } });
    const byId = new Map(found.map((node) => [node.id, node]));
    const now = new Date();
    const reinforced: MemoryNode[] = [];
    for (const id of ids) {
      const node = byId.get(id);
      if (!node) continue;
      const updated = await this.nodes.update(id, {
        importance: reinforceValue(node.importance, strength),
        last_reinforce: now,
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
      const updated = await this.edges.update(
        { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
        {
          strength: reinforceValue(edge.strength, strength),
          last_reinforce: now,
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
    const updated = await this.nodes.update(memoryId, {
      status: MEMORY_STATUS_INVALIDATED,
      validity: 0,
      invalidated_at: new Date(),
      invalidate_reason: reason,
      ...(supersededBy !== null ? { superseded_by: supersededBy } : {}),
    });
    if (!updated) throw new Error(`invalidateMemory: unknown memory ${memoryId}`);
    return updated;
  }

  async invalidateMemoryEdge(edgeId: string, reason: string): Promise<MemoryEdge | null> {
    const rows = await this.edges.list({ table: MEMORY_EDGE_TABLE, where: { id: edgeId } });
    const edge = rows.map(mapMemoryEdge)[0];
    if (!edge) return null;
    const updated = await this.edges.update(
      { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
      { status: MEMORY_STATUS_INVALIDATED, invalidated_at: new Date(), invalidate_reason: reason },
      { id: edge.id }
    );
    return updated[0] ? mapMemoryEdge(updated[0]) : null;
  }

  async reinstateMemory(
    memoryId: string,
    validity: number = HALF_LIFE.INITIAL_VALIDITY
  ): Promise<MemoryNode | null> {
    return this.nodes.update(memoryId, {
      status: MEMORY_STATUS_ACTIVE,
      validity,
      invalidated_at: null,
      invalidate_reason: null,
      superseded_by: null,
    });
  }

  async reinstateMemoryEdge(edgeId: string): Promise<MemoryEdge | null> {
    const rows = await this.edges.list({ table: MEMORY_EDGE_TABLE, where: { id: edgeId } });
    const edge = rows.map(mapMemoryEdge)[0];
    if (!edge) return null;
    const updated = await this.edges.update(
      { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
      { status: MEMORY_STATUS_ACTIVE, invalidated_at: null, invalidate_reason: null },
      { id: edge.id }
    );
    return updated[0] ? mapMemoryEdge(updated[0]) : null;
  }

  async setMemoryValidity(memoryId: string, validity: number): Promise<MemoryNode | null> {
    if (!Number.isFinite(validity)) {
      throw new Error(`setMemoryValidity: validity must be finite, got ${validity}`);
    }
    return this.nodes.update(memoryId, { validity });
  }

  async addMemory(node: NewMemoryNode): Promise<MemoryNode> {
    if (!(MEMORY_NODE_TYPES as readonly string[]).includes(node.type)) {
      throw new Error(`addMemory: unknown type ${JSON.stringify(node.type)}`);
    }
    const [docVector] = await embedDocTexts(this.embedder, [node.description]);
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
      embedding: [...docVector!],
    });
  }

  async addEdge(edge: NewMemoryEdge): Promise<MemoryEdge> {
    if (!(MEMORY_EDGE_TYPES as readonly string[]).includes(edge.type)) {
      throw new Error(`addEdge: unknown type ${JSON.stringify(edge.type)}`);
    }
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
      },
    });
    return mapMemoryEdge(row);
  }

  async tick(): Promise<void> {
    for (const node of await this.nodes.findAll({ where: { status: MEMORY_STATUS_ACTIVE } })) {
      await this.nodes.update(node.id, {
        importance: decayValue(node.importance),
        validity: decayValidity(node.validity),
      });
    }
    const rows = await this.edges.list({
      table: MEMORY_EDGE_TABLE,
      where: { status: MEMORY_STATUS_ACTIVE },
    });
    for (const edge of rows.map(mapMemoryEdge)) {
      await this.edges.update(
        { table: MEMORY_EDGE_TABLE, fromId: edge.from, toId: edge.to },
        { strength: decayValue(edge.strength) },
        { id: edge.id }
      );
    }
  }
}
