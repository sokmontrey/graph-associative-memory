import {
  MEMORY_EMBEDDING_PROPERTY,
  MEMORY_NODE_LABEL,
  MEMORY_VECTOR_INDEX,
} from "../../db/relations.ts";
import { assertCypherIdentifier, type GraphDbRepo } from "../../repos/graphDb/index.ts";
import { rankCandidates, type Vector, type VectorHit, type VectorIndex } from "./index.ts";

export class VectorIndexUnavailable extends Error {}

// Native disk-based HNSW via Ladybug's `vector` extension. Best-effort: the
// extension needs a one-time networked INSTALL and a version-compatible
// binary — use ensureAvailable() and fall back to StoredEmbeddingVectorIndex
// when it throws VectorIndexUnavailable.
export class LadybugVectorIndex implements VectorIndex {
  private readonly db: GraphDbRepo;
  private readonly table: string;
  private readonly indexName: string;
  private readonly property: string;

  constructor(
    db: GraphDbRepo,
    opts?: { table?: string; indexName?: string; property?: string }
  ) {
    this.db = db;
    this.table = opts?.table ?? MEMORY_NODE_LABEL;
    this.indexName = opts?.indexName ?? MEMORY_VECTOR_INDEX;
    this.property = opts?.property ?? MEMORY_EMBEDDING_PROPERTY;
    for (const [value, what] of [
      [this.table, "table"],
      [this.indexName, "index name"],
      [this.property, "property"],
    ] as const) {
      assertCypherIdentifier(value, what);
    }
  }

  async ensureAvailable(): Promise<void> {
    try {
      await this.db.query("LOAD EXTENSION vector;");
    } catch (loadError) {
      if (!String(loadError).includes("has not been installed")) throw new VectorIndexUnavailable(String(loadError));
      try {
        await this.db.query("INSTALL vector;");
        await this.db.query("LOAD EXTENSION vector;");
      } catch (installError) {
        throw new VectorIndexUnavailable(String(installError));
      }
    }
    try {
      await this.db.query(
        `CALL CREATE_VECTOR_INDEX('${this.table}', '${this.indexName}', '${this.property}', metric := 'cosine');`
      );
    } catch (createError) {
      // CREATE is not idempotent; an existing index is the expected case on
      // reopen. Anything else (e.g. ABI mismatch) also degrades to fallback.
      if (!/already exists|duplicate/i.test(String(createError))) {
        throw new VectorIndexUnavailable(String(createError));
      }
    }
  }

  async upsert(id: string, vector: Vector): Promise<void> {
    await this.db.query(
      `MATCH (n:${this.table} {id: $id}) SET n.${this.property} = $vector;`,
      { id, vector: [...vector] }
    );
  }

  async search(vector: Vector, k: number): Promise<VectorHit[]> {
    const rows = await this.db.query(
      `CALL QUERY_VECTOR_INDEX('${this.table}', '${this.indexName}', $vector, $k) RETURN node.id AS id, distance;`,
      { vector: [...vector], k }
    );
    return rows.map((row) => ({
      id: String(row["id"]),
      // Cosine metric: distance = 1 - cosine similarity (normalized vectors).
      score: 1 - Number(row["distance"]),
    }));
  }

  async remove(_id: string): Promise<void> {
    // No-op: DETACH DELETE on the node drops its index entry.
  }
}

// Brute-force cosine over the stored embedding column. Always correct, no
// extension, O(n) per query — the default at memory-graph scale.
export class StoredEmbeddingVectorIndex implements VectorIndex {
  private readonly db: GraphDbRepo;
  private readonly table: string;
  private readonly property: string;

  constructor(
    db: GraphDbRepo,
    opts?: { table?: string; property?: string }
  ) {
    this.db = db;
    this.table = opts?.table ?? MEMORY_NODE_LABEL;
    this.property = opts?.property ?? MEMORY_EMBEDDING_PROPERTY;
    assertCypherIdentifier(this.table, "table");
    assertCypherIdentifier(this.property, "property");
  }

  async upsert(id: string, vector: Vector): Promise<void> {
    await this.db.query(
      `MATCH (n:${this.table} {id: $id}) SET n.${this.property} = $vector;`,
      { id, vector: [...vector] }
    );
  }

  async search(vector: Vector, k: number): Promise<VectorHit[]> {
    const rows = await this.db.query(
      `MATCH (n:${this.table}) WHERE n.${this.property} IS NOT NULL RETURN n.id AS id, n.${this.property} AS embedding;`
    );
    return rankCandidates(
      vector,
      rows.map((row) => ({ id: String(row["id"]), vector: (row["embedding"] as number[]).slice() })),
      k
    );
  }

  async remove(_id: string): Promise<void> {
    // No-op: nothing cached outside the node row itself.
  }
}

// Prefer HNSW, degrade to brute force. Never throws: the stored-embedding
// index only needs the embedding column to exist (ensureSchema).
export async function createNodeVectorIndex(db: GraphDbRepo): Promise<VectorIndex> {
  const hnsw = new LadybugVectorIndex(db);
  try {
    await hnsw.ensureAvailable();
    return hnsw;
  } catch (error) {
    console.warn(`Vector index: HNSW unavailable (${error}), using brute-force search.`);
    return new StoredEmbeddingVectorIndex(db);
  }
}
