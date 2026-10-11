import { DB_PATH } from "./db/index.ts";
import { MEMORY_NODE_LABEL } from "./db/relations.ts";
import {
  MEMORY_NODE_FIELDS,
  mapMemoryNode,
  type MemoryNode,
  type MemoryNodePatch,
  type MemoryNodeUpsert,
} from "./models/memory.ts";
import { LadybugEdgeRepo, type EdgeRepo } from "./repos/edges/index.ts";
import { LadybugGraphDbRepo } from "./repos/graphDb/index.ts";
import { LadybugNodeRepo, type NodeRepo } from "./repos/node/index.ts";
import { GemmaEmbedder } from "./services/embeddings/gemmaEmbedder.ts";
import type { TextEmbedder } from "./services/embeddings/index.ts";
import { createNodeVectorIndex } from "./services/embeddings/vectorIndex.ts";
import { GraphMemoryService, MEMORY_EDGE_TABLE_CONFIG } from "./services/graphMemory/graphMemoryService.ts";
import type { MemorySearchProvider } from "./services/graphMemory/search/index.ts";
import { VectorMemorySearch } from "./services/graphMemory/search/vectorMemorySearch.ts";
import { HighlevelMemoryService } from "./services/highlevelMemory/highlevelMemoryService.ts";
import type { LinkGrounder } from "./services/highlevelMemory/linkGrounder.ts";
import {
  createMemoryEventBus,
  type MemoryEventBus,
} from "./services/highlevelMemory/events.ts";

export type MemoryStackOptions = {
  /** Overrides DB_PATH (shared french-learning-2 DB / LBUG_DB_PATH). */
  dbPath?: string;
  /** Defaults to the FastEmbed e5 model (downloads ~2 GB on first use). */
  embedder?: TextEmbedder;
  /** Defaults to vector search over the node embeddings. */
  search?: MemorySearchProvider;
  /** Grounded model for the high-level service; defaults to JevLinkGrounder. */
  grounder?: LinkGrounder;
  /** Instrumentation sink for the dashboard; defaults to a fresh in-process bus. */
  events?: MemoryEventBus;
  edgeRepo?: EdgeRepo;
  nodeRepo?: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
};

export type MemoryStack = {
  db: LadybugGraphDbRepo;
  service: GraphMemoryService;
  highlevel: HighlevelMemoryService;
  embedder: TextEmbedder;
  search: MemorySearchProvider;
  events: MemoryEventBus;
  nodeRepo: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
  edgeRepo: EdgeRepo;
  close(): Promise<void>;
};

/**
 * Wires the memory graph stack: DB + embedder + search + service.
 * Inject `embedder`/`search` to experiment without the embedding model.
 */
export async function createMemoryStack(
  options: MemoryStackOptions = {}
): Promise<MemoryStack> {
  const db = new LadybugGraphDbRepo({ dbPath: options.dbPath ?? DB_PATH });
  await db.open();
  const embedder = options.embedder ?? (await GemmaEmbedder.create());
  const edgeRepo =
    options.edgeRepo ?? new LadybugEdgeRepo(db, [MEMORY_EDGE_TABLE_CONFIG]);
  const nodeRepo =
    options.nodeRepo ??
    new LadybugNodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>(db, {
      label: MEMORY_NODE_LABEL,
      fields: MEMORY_NODE_FIELDS,
      map: mapMemoryNode,
    });
  const search =
    options.search ??
    new VectorMemorySearch(edgeRepo, embedder, await createNodeVectorIndex(db));
  const events = options.events ?? createMemoryEventBus();
  const service = await GraphMemoryService.create({
    db,
    embedder,
    search,
    nodeRepo,
    edgeRepo,
  });
  const highlevel = await HighlevelMemoryService.create({
    db,
    embedder,
    search,
    grounder: options.grounder,
    events,
    nodeRepo,
    edgeRepo,
  });
  return {
    db,
    service,
    highlevel,
    embedder,
    search,
    events,
    nodeRepo,
    edgeRepo,
    close: () => db.close(),
  };
}

export { DB_PATH, SHARED_DB_PATH } from "./db/index.ts";
export type { MemoryEdge, MemoryNode, MemoryStatus, NewMemoryEdge, NewMemoryNode } from "./models/memory.ts";
export { memoryRank } from "./models/memory.ts";
export { MEMORY_STATUS_ACTIVE, MEMORY_STATUS_INVALIDATED } from "./db/relations.ts";
export type {
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
} from "./services/highlevelMemory/index.ts";
export {
  createMemoryEventBus,
  NOOP_MEMORY_EVENTS,
  type MemoryEvent,
  type MemoryEventBus,
  type MemoryOpKind,
} from "./services/highlevelMemory/events.ts";
export { HighlevelMemoryService } from "./services/highlevelMemory/highlevelMemoryService.ts";
export { JevLinkGrounder, type JevLinkGrounderOptions } from "./services/highlevelMemory/jevLinkGrounder.ts";
export type { GroundedLink, LinkGrounder } from "./services/highlevelMemory/linkGrounder.ts";
export type { MemoryService } from "./services/graphMemory/index.ts";
export type { MemorySearchProvider } from "./services/graphMemory/search/index.ts";
export type { TextEmbedder } from "./services/embeddings/index.ts";
