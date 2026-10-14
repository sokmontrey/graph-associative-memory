// The graph has ONE node shape and ONE edge shape. `kind` and `relation`
// are free-form strings (validated nowhere) — meaning lives in the text the
// subagent reads, not in a discriminator column.

export const MEMORY_NODE_LABEL = "MemoryNode";
export const MEMORY_EDGE_TABLE = "MEMORY_RELATES_TO";
export const MEMORY_EMBEDDING_PROPERTY = "embedding";
export const MEMORY_VECTOR_INDEX = "mem_embedding_idx";
