export interface MemorySearchHit {
  id: string;
  score: number;
}

// Semantic search over memory contents. Implementations select candidates by
// relevance (best match first); the service hydrates via repos and ranks by
// relevance * importance^alpha. Swap impls without touching the service.
export interface MemorySearchProvider {
  searchNodes(query: string, limit: number): Promise<MemorySearchHit[]>;
}
