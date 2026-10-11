export interface MemorySearchHit {
  id: string;
  score: number;
}

// Semantic search over memory descriptions. Implementations select
// candidates by relevance; the service hydrates via repos and orders by
// importance/strength. Swap impls without touching the service.
export interface MemorySearchProvider {
  searchNodes(query: string, limit: number): Promise<MemorySearchHit[]>;
  searchEdges(memoryId: string, query: string, limit: number): Promise<MemorySearchHit[]>;
}
