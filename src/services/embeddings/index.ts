// Generic, reusable text-embedding + vector-search primitives. Nothing
// here is memory-specific: any feature needing semantic search composes
// these two interfaces.

// The embedder is EmbeddingGemma-300M; the schema mirrors its dimension.
export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from "./config.ts";

export type Vector = readonly number[];

export interface TextEmbedder {
  readonly modelId: string;
  readonly dimensions: number;
  embed(text: string): Promise<Vector>;
  embedMany(texts: readonly string[]): Promise<readonly Vector[]>;
  // Asymmetric retrieval (e.g. e5's query:/passage: prefixes). Optional so
  // plain models stay compatible; default helpers below fall back to
  // embed/embedMany when absent.
  embedQuery?(text: string): Promise<Vector>;
  embedDocuments?(texts: readonly string[]): Promise<readonly Vector[]>;
}

export async function embedQueryText(embedder: TextEmbedder, query: string): Promise<Vector> {
  return embedder.embedQuery ? embedder.embedQuery(query) : embedder.embed(query);
}

export async function embedDocTexts(
  embedder: TextEmbedder,
  texts: readonly string[]
): Promise<readonly Vector[]> {
  return embedder.embedDocuments ? embedder.embedDocuments(texts) : embedder.embedMany(texts);
}

export interface VectorHit {
  id: string;
  score: number;
}

export interface VectorIndex {
  upsert(id: string, vector: Vector): Promise<void>;
  search(vector: Vector, k: number): Promise<VectorHit[]>;
  remove(id: string): Promise<void>;
}

export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch ${a.length} !== ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function rankCandidates(
  query: Vector,
  candidates: ReadonlyArray<{ id: string; vector: Vector }>,
  k: number
): VectorHit[] {
  return candidates
    .map(({ id, vector }) => ({ id, score: cosineSimilarity(query, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}
