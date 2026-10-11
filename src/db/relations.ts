// Ladybug has no ENUM type, so discriminators are STRING columns validated
// here — the single write path for edges. TS narrows at compile time,
// assert functions reject bad values at runtime.

// MemoryNode kinds (single MemoryNode table with `type` discriminator).
export const MEMORY_NODE_TYPES = ["preference", "trait", "observation"] as const;
export type MemoryNodeType = (typeof MEMORY_NODE_TYPES)[number];

// Memory↔memory edge kinds (single MEMORY_RELATES_TO table with `type`
// discriminator). description is unified across all four kinds.
export const MEMORY_EDGE_TYPES = [
  "supports",
  "contradicts",
  "related_to",
  "evokes",
] as const;
export type MemoryEdgeType = (typeof MEMORY_EDGE_TYPES)[number];

// Lifecycle of a node or edge. `invalidated` is a soft tombstone: the row is
// kept for audit/why but excluded from every surfacing path, and can be
// reinstated. Orthogonal to salience (importance/strength) — this is the truth
// axis the agent flips decisively when it resolves a contradiction.
export const MEMORY_STATUS_ACTIVE = "active";
export const MEMORY_STATUS_INVALIDATED = "invalidated";
export const MEMORY_STATUSES = [MEMORY_STATUS_ACTIVE, MEMORY_STATUS_INVALIDATED] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

// Memory table wiring shared by the memory service and search providers.
export const MEMORY_NODE_LABEL = "MemoryNode";
export const MEMORY_EDGE_TABLE = "MEMORY_RELATES_TO";
export const MEMORY_EMBEDDING_PROPERTY = "embedding";
export const MEMORY_VECTOR_INDEX = "mem_embedding_idx";
