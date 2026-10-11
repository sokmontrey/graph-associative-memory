// The embedder is EmbeddingGemma-300M (768 dims) via @kessler/gemma-embedding.
// The database's vector column is sized from EMBEDDING_DIMENSIONS, so a
// database built here cannot be reopened with a different-dimension embedder
// (see the guard in src/db/schema.ts).
export const EMBEDDING_MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
export const EMBEDDING_DIMENSIONS = 768;
