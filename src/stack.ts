// Composition root: wires the memory graph stack (DB + embedder + search +
// services). This is the wiring entry — not the public library entry
// (src/index.ts) and not the process entry (src/runtime/start.ts).
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
  /** Overrides the resolved DB path (MEMORY_DB_PATH / LBUG_DB_PATH). */
  dbPath?: string;
  /** Defaults to EmbeddingGemma-300M (downloads ~300 MB on first use). */
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
    // Share the low-level service so MCP ops, dashboard tick, and snapshots all
    // advance the same DecayClock.
    memory: service,
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
