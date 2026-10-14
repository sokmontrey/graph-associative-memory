// Public library entry: re-exports only. Wiring lives in ./stack.ts,
// the process entry (MCP stdio + dashboard) is ./runtime/start.ts.
export { createMemoryStack, type MemoryStack, type MemoryStackOptions } from "./stack.ts";
export { DB_PATH, DEFAULT_DB_PATH, resolveDbPath } from "./db/index.ts";
export type { MemoryEdge, MemoryNode, MemoryTools } from "./models/memory-graph.ts";
export { MEMORY_POLICY, saturatingReinforce } from "./models/memory-graph.ts";
export { MemoryService } from "./services/memory/memoryService.ts";
export {
  createMemoryEventBus,
  NOOP_MEMORY_EVENTS,
  type MemoryEvent,
  type MemoryEventBus,
  type MemoryOpKind,
} from "./services/memory/events.ts";
export type { MemorySearchProvider } from "./services/search/index.ts";
export type { TextEmbedder } from "./services/embeddings/index.ts";
