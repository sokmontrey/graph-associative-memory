// Composition root: wires the memory graph stack (DB + embedder + search +
// service). This is the wiring entry — not the public library entry
// (src/index.ts) and not the process entry (src/runtime/start.ts).
import { DB_PATH } from "./db/index.ts";
import { MEMORY_NODE_LABEL } from "./db/relations.ts";
import {
  MEMORY_NODE_FIELDS,
  mapMemoryNode,
  type MemoryNode,
  type MemoryNodePatch,
  type MemoryNodeUpsert,
} from "./models/index.ts";
import { LadybugEdgeRepo, type EdgeRepo } from "./repos/edges/index.ts";
import { LadybugGraphDbRepo } from "./repos/graphDb/index.ts";
import { LadybugNodeRepo, type NodeRepo } from "./repos/node/index.ts";
import { GemmaEmbedder } from "./services/embeddings/gemmaEmbedder.ts";
import type { TextEmbedder } from "./services/embeddings/index.ts";
import { createNodeVectorIndex } from "./services/embeddings/vectorIndex.ts";
import { ContainsMemorySearch } from "./services/search/containsMemorySearch.ts";
import type { MemorySearchProvider } from "./services/search/index.ts";
import { VectorMemorySearch } from "./services/search/vectorMemorySearch.ts";
import {
  MEMORY_EDGE_TABLE_CONFIG,
  MemoryService,
} from "./services/memory/memoryService.ts";
import {
  createMemoryEventBus,
  type MemoryEventBus,
} from "./services/memory/events.ts";

export type MemoryStackOptions = {
  /** Overrides the resolved DB path (MEMORY_DB_PATH / LBUG_DB_PATH). */
  dbPath?: string;
  /** Defaults to EmbeddingGemma-300M (downloads ~300 MB on first use). */
  embedder?: TextEmbedder;
  /** Defaults to vector search over the node embeddings. */
  search?: MemorySearchProvider;
  /** Instrumentation sink for the dashboard; defaults to a fresh in-process bus. */
  events?: MemoryEventBus;
  edgeRepo?: EdgeRepo;
  nodeRepo?: NodeRepo<MemoryNode, MemoryNodeUpsert, MemoryNodePatch>;
};

export type MemoryStack = {
  db: LadybugGraphDbRepo;
  service: MemoryService;
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
  const nodeIndex = await createNodeVectorIndex(db);
  const search = options.search ?? new VectorMemorySearch(embedder, nodeIndex);
  const events = options.events ?? createMemoryEventBus();
  const service = await MemoryService.create({
    db,
    embedder,
    search,
    fallback: new ContainsMemorySearch(db),
    events,
    nodeRepo,
    edgeRepo,
  });
  return {
    db,
    service,
    embedder,
    search,
    events,
    nodeRepo,
    edgeRepo,
    close: () => db.close(),
  };
}
