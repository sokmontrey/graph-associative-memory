import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Database } from "@ladybugdb/core";
import { ensureSchema } from "./schema.ts";

// Default database is isolated under the project (data/ladybug). Point
// LBUG_DB_PATH at another file to use a different one — including the shared
// french-learning-2 graph, whose 1024-dim vectors are incompatible with this
// project's EmbeddingGemma embedder (768-dim).
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, "data", "ladybug");
export const SHARED_DB_PATH = resolve(
  PROJECT_ROOT,
  "..",
  "french-learning-2",
  "data",
  "ladybug"
);

export const DB_PATH = process.env.LBUG_DB_PATH ?? DEFAULT_DB_PATH;

let database: Database | null = null;
let connection: Connection | null = null;

export async function openDatabase(): Promise<Connection> {
  if (connection) {
    return connection;
  }
  mkdirSync(dirname(DB_PATH), { recursive: true });
  database = new Database(DB_PATH);
  connection = new Connection(database);
  await ensureSchema(connection);
  return connection;
}

export function getConnection(): Connection {
  if (!connection) {
    throw new Error("Database is not open. Call openDatabase() first.");
  }
  return connection;
}

export async function closeDatabase(): Promise<void> {
  if (connection) {
    await connection.close();
    connection = null;
  }
  if (database) {
    await database.close();
    database = null;
  }
}
