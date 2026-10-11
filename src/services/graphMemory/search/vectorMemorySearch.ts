import { MEMORY_EDGE_TABLE } from "../../../db/relations.ts";
import type { EdgeRepo } from "../../../repos/edges/index.ts";
import {
  embedDocTexts,
  embedQueryText,
  rankCandidates,
  type TextEmbedder,
  type VectorIndex,
} from "../../embeddings/index.ts";
import type { MemorySearchHit, MemorySearchProvider } from "./index.ts";

// Vector search: HNSW (or brute-force fallback) over node embeddings;
// edges can't be HNSW-indexed (node tables only), so edge descriptions are
// embedded per query and ranked in-service — bounded by one node's fan-out.
export class VectorMemorySearch implements MemorySearchProvider {
  private readonly edges: EdgeRepo;
  private readonly embedder: TextEmbedder;
  private readonly nodeIndex: VectorIndex;
  private readonly edgeTable: string;

  constructor(
    edges: EdgeRepo,
    embedder: TextEmbedder,
    nodeIndex: VectorIndex,
    edgeTable: string = MEMORY_EDGE_TABLE
  ) {
    this.edges = edges;
    this.embedder = embedder;
    this.nodeIndex = nodeIndex;
    this.edgeTable = edgeTable;
  }

  async searchNodes(query: string, limit: number): Promise<MemorySearchHit[]> {
    const vector = await embedQueryText(this.embedder, query);
    return this.nodeIndex.search(vector, limit);
  }

  async searchEdges(memoryId: string, query: string, limit: number): Promise<MemorySearchHit[]> {
    const rows = await this.edges.list({ table: this.edgeTable, fromId: memoryId });
    if (rows.length === 0) return [];
    const [vector, docVectors] = await Promise.all([
      embedQueryText(this.embedder, query),
      embedDocTexts(
        this.embedder,
        rows.map((row) => String(row["e_description"]))
      ),
    ]);
    return rankCandidates(
      vector,
      rows.map((row, i) => ({ id: String(row["e_id"]), vector: docVectors[i]! })),
      limit
    );
  }
}
