export interface MemorySearchHit {
  id: string;
  score: number;
}

// Semantic search over memory descriptions. Implementations select
// candidates by relevance (best match first); the service hydrates via repos
// and preserves that similarity order, falling back to importance ordering
// only when no query is given. Swap impls without touching the service.
export interface MemorySearchProvider {
  searchNodes(query: string, limit: number): Promise<MemorySearchHit[]>;
  searchEdges(memoryId: string, query: string, limit: number): Promise<MemorySearchHit[]>;
}
