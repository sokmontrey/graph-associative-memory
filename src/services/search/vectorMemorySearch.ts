import type { TextEmbedder, VectorIndex } from "../embeddings/index.ts";
import { embedQueryText } from "../embeddings/index.ts";
import type { MemorySearchHit, MemorySearchProvider } from "./index.ts";

// Vector search: HNSW (or brute-force fallback) over node embeddings.
export class VectorMemorySearch implements MemorySearchProvider {
  private readonly embedder: TextEmbedder;
  private readonly nodeIndex: VectorIndex;

  constructor(embedder: TextEmbedder, nodeIndex: VectorIndex) {
    this.embedder = embedder;
    this.nodeIndex = nodeIndex;
  }

  async searchNodes(query: string, limit: number): Promise<MemorySearchHit[]> {
    const vector = await embedQueryText(this.embedder, query);
    return this.nodeIndex.search(vector, limit);
  }
}
