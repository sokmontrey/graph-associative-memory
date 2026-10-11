import { GemmaEmbedding, type GemmaEmbeddingOptions } from "@kessler/gemma-embedding";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  type TextEmbedder,
  type Vector,
} from "./index.ts";

export type GemmaEmbedderOptions = {
  /** Local model dir or a custom HF repo id; defaults to onnx-community's ONNX repo. */
  modelPath?: string;
  /** "cpu" (default in Node), "wasm", or "webgpu". */
  device?: "cpu" | "wasm" | "webgpu";
  /** Quantization; defaults to MEMORY_GEMMA_DTYPE or "q8". Gemma has no fp16. */
  dtype?: string;
  onProgress?: GemmaEmbeddingOptions["onProgress"];
};

// EmbeddingGemma-300M via ONNX (@kessler/gemma-embedding). 768 dims, mean
// pooling, asymmetric prompts handled by the library: queries get
// "task: search result | query: …", documents get "title: none | text: …".
export class GemmaEmbedder implements TextEmbedder {
  readonly modelId = EMBEDDING_MODEL_ID;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private readonly model: GemmaEmbedding;

  private constructor(model: GemmaEmbedding) {
    this.model = model;
  }

  static async create(options: GemmaEmbedderOptions = {}): Promise<GemmaEmbedder> {
    const dtype = options.dtype ?? process.env["MEMORY_GEMMA_DTYPE"] ?? "q8";
    const model = new GemmaEmbedding({
      device: options.device ?? "cpu",
      dtype,
      ...(options.modelPath ? { modelPath: options.modelPath } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    await model.load();
    const probe = await model.embed("dimension probe", "document");
    if (probe.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `GemmaEmbedder: ${EMBEDDING_MODEL_ID} returned ${probe.length} dims, schema expects ${EMBEDDING_DIMENSIONS}`
      );
    }
    return new GemmaEmbedder(model);
  }

  async embed(text: string): Promise<Vector> {
    return this.model.embed(text, "document");
  }

  async embedMany(texts: readonly string[]): Promise<readonly Vector[]> {
    return this.model.embedBatch([...texts], "document");
  }

  async embedQuery(text: string): Promise<Vector> {
    return this.model.embed(text, "query");
  }

  async embedDocuments(texts: readonly string[]): Promise<readonly Vector[]> {
    return this.model.embedBatch([...texts], "document");
  }

  async unload(): Promise<void> {
    await this.model.unload();
  }
}
