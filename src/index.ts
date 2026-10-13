// Public library entry: re-exports only. Wiring lives in ./stack.ts,
// the process entry (MCP stdio + dashboard) is ./runtime/start.ts.
export { createMemoryStack, type MemoryStack, type MemoryStackOptions } from "./stack.ts";
export { DB_PATH, DEFAULT_DB_PATH, resolveDbPath } from "./db/index.ts";
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
