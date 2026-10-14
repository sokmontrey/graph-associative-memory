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

// BREAKING (v2 experiment): one node shape, one edge shape, free-form labels.
// Legacy tables from the typed/validity design are dropped on sight — the old
// rows cannot be mapped onto the new shape, and this branch keeps no compat.
const LEGACY_TABLES = ["MemoryNode", "MEMORY_RELATES_TO", "MemoryDecayClock"];

const SCHEMA_STATEMENTS = [
  // content: the only indexed/searched text. kind: free tag.
  // importance: half-life value (DOUBLE).
  // createdAt/lastReinforcedAt: epoch milliseconds (INT64). Integers, not
  // TIMESTAMPs: the driver days-truncates Date params, which would make
  // "latest first" ordering meaningless within a day.
  // embedding: FLOAT[DIMS] document vector (EmbeddingGemma-300M).
  `CREATE NODE TABLE IF NOT EXISTS MemoryNode(
    id STRING PRIMARY KEY,
    content STRING,
    kind STRING,
    importance DOUBLE,
    createdAt INT64,
    lastReinforcedAt INT64,
    embedding FLOAT[${EMBEDDING_DIMENSIONS}]
  );`,
  // id: edge identity (rel tables have none natively).
  // relation: free label. description: WHY linked (the subagent reads this).
  // strength: half-life value (DOUBLE).
  `CREATE REL TABLE IF NOT EXISTS MEMORY_RELATES_TO(
    FROM MemoryNode TO MemoryNode,
    id STRING,
    relation STRING,
    description STRING,
    strength DOUBLE,
    createdAt INT64,
    lastReinforcedAt INT64
  );`,
];

async function tableColumns(conn: Connection, table: string): Promise<Set<string> | null> {
  try {
    const result = await conn.query(`CALL table_info('${table}') RETURN *;`);
    if (Array.isArray(result)) return null;
    const rows = (await result.getAll()) as Array<Record<string, unknown>>;
    return new Set(rows.map((row) => String(row["name"])));
  } catch {
    return null;
  }
}

// Per-table legacy markers. NOTE: `description` alone must NOT mark a table
// as legacy — it is a legitimate column of the NEW edge table (a previous
// version of this check dropped MEMORY_RELATES_TO on every boot, wiping all
// edges while nodes survived).
async function isLegacyTable(conn: Connection, table: string): Promise<boolean> {
  const names = await tableColumns(conn, table);
  if (!names) return false;
  if (table === "MemoryNode") {
    // New shape carries `content`; legacy carries `description`/`validity`.
    if (names.has("content")) return false;
    return names.has("description") || names.has("validity") || names.has("type");
  }
  if (table === "MEMORY_RELATES_TO") {
    // New shape carries `relation`; legacy carries `type`.
    if (names.has("relation")) return false;
    return names.has("type");
  }
  return false;
}

export async function ensureSchema(conn: Connection): Promise<void> {
  for (const table of LEGACY_TABLES) {
    if (await isLegacyTable(conn, table)) {
      // The vector index references the node table: drop it first.
      try {
        await conn.query(`CALL DROP_VECTOR_INDEX('MemoryNode', 'mem_embedding_idx');`);
      } catch {
        /* no index or already gone */
      }
      await conn.query(`DROP TABLE ${table};`);
    }
  }
  for (const statement of SCHEMA_STATEMENTS) {
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
        `Remove the database (or point MEMORY_DB_PATH at another path) to recreate it.`
    );
  }
}
