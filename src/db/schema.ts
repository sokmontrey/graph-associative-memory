import type { Connection } from "@ladybugdb/core";
import { EMBEDDING_DIMENSIONS } from "../services/embeddings/index.ts";

export function toTimestamp(d: Date): string {
  // UTC getters: timestamp() parses naive strings as UTC; local getters shift.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

const SCHEMA_STATEMENTS = [
  // Memory: ONE node table with a `type` discriminator, not one table per
  // kind — all kinds share the same shape.
  // type ∈ preference | trait | observation.
  // description: the only indexed/searched text (mirrors MemoryNode).
  // importance: salience, half-life value (DOUBLE).
  // validity: believed-ness 0..1 (DOUBLE), decays slowly, multiplies into rank.
  // status: active | invalidated (soft tombstone).
  // last_reinforce / invalidated_at: TIMESTAMP.
  // superseded_by: id of the memory that replaced this one (contradiction wins).
  // embedding: FLOAT[DIMS] document vector, DIMS = EMBEDDING_DIMENSIONS
  // (EmbeddingGemma-300M). The vector extension requires a fixed-size
  // FLOAT/DOUBLE array property.
  `CREATE NODE TABLE IF NOT EXISTS MemoryNode(
    id STRING PRIMARY KEY,
    type STRING,
    description STRING,
    importance DOUBLE,
    validity DOUBLE,
    status STRING,
    last_reinforce TIMESTAMP,
    invalidated_at TIMESTAMP,
    invalidate_reason STRING,
    superseded_by STRING,
    embedding FLOAT[${EMBEDDING_DIMENSIONS}]
  );`,
  // Memory ↔ memory: ONE rel table with a `type` discriminator.
  // type ∈ supports | contradicts | related_to | evokes.
  // description: searchable text, unified across all four kinds.
  // strength: salience, half-life value (DOUBLE). status/validity mirror nodes.
  // id: edge identity (rel tables have none natively; required so callers
  // can select edges for getMemoryNeighbors).
  `CREATE REL TABLE IF NOT EXISTS MEMORY_RELATES_TO(
    FROM MemoryNode TO MemoryNode,
    id STRING,
    type STRING,
    description STRING,
    strength DOUBLE,
    status STRING,
    last_reinforce TIMESTAMP,
    invalidated_at TIMESTAMP,
    invalidate_reason STRING
  );`,
  // Lazy-decay clock: ONE row (id 'global') holding the running log-sums every
  // memory/edge watermark settles against. Advanced O(1) per operation; rows
  // apply their personal backlog lazily on read. Log-space so thousands of
  // near-1.0 factors drift linearly instead of underflowing.
  `CREATE NODE TABLE IF NOT EXISTS MemoryDecayClock(
    id STRING PRIMARY KEY,
    l_importance DOUBLE,
    l_validity DOUBLE,
    l_strength DOUBLE,
    seq DOUBLE
  );`,
];

// Idempotent additive migration for databases created before the validity
// lifecycle existed. ADD IF NOT EXISTS with a DEFAULT backfills existing rows,
// so pre-existing memories become active with full validity. Additive columns
// don't break other readers of the shared database.
const MIGRATION_STATEMENTS = [
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS validity DOUBLE DEFAULT 1.0;`,
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS status STRING DEFAULT 'active';`,
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS invalidated_at TIMESTAMP;`,
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS invalidate_reason STRING;`,
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS superseded_by STRING;`,
  `ALTER TABLE MEMORY_RELATES_TO ADD IF NOT EXISTS status STRING DEFAULT 'active';`,
  `ALTER TABLE MEMORY_RELATES_TO ADD IF NOT EXISTS invalidated_at TIMESTAMP;`,
  `ALTER TABLE MEMORY_RELATES_TO ADD IF NOT EXISTS invalidate_reason STRING;`,
  // Lazy-decay watermarks: per-row snapshot of the global log-clock at last
  // settle. DEFAULT 0.0 (= genesis clock) means legacy rows owe decay since
  // the clock began — correct, they were never settled.
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS decay_l_importance DOUBLE DEFAULT 0.0;`,
  `ALTER TABLE MemoryNode ADD IF NOT EXISTS decay_l_validity DOUBLE DEFAULT 0.0;`,
  `ALTER TABLE MEMORY_RELATES_TO ADD IF NOT EXISTS decay_l_strength DOUBLE DEFAULT 0.0;`,
];

export async function ensureSchema(conn: Connection): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await conn.query(statement);
  }
  for (const statement of MIGRATION_STATEMENTS) {
    await conn.query(statement);
  }
  await assertEmbeddingDimensions(conn);
}

// The vector column is fixed-size: a database built for one embedder can't be
// reused with another. Fail fast with an actionable message instead of a
// confusing error on the first write.
async function assertEmbeddingDimensions(conn: Connection): Promise<void> {
  const expected = `FLOAT[${EMBEDDING_DIMENSIONS}]`;
  let actual: string | null = null;
  try {
    const result = await conn.query("CALL table_info('MemoryNode') RETURN *;");
    if (Array.isArray(result)) return;
    const rows = (await result.getAll()) as Array<Record<string, unknown>>;
    const embedding = rows.find((row) => row["name"] === "embedding");
    actual = embedding ? String(embedding["type"]) : null;
  } catch {
    return;
  }
  if (actual !== null && actual !== expected) {
    throw new Error(
      `MemoryNode.embedding is ${actual} but this build uses ${expected}. ` +
        `Remove the database (or point LBUG_DB_PATH at another path) to recreate it.`
    );
  }
}
