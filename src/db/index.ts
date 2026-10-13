// Database location for this project. The DB file is isolated under the
// project (data/ladybug) by default.
//
// Override with `MEMORY_DB_PATH` (`LBUG_DB_PATH` is still honoured as a
// legacy fallback). Pointing it elsewhere just selects a different file —
// there is no shared-database mode and no reference to any other project.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, "data", "ladybug");

export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["MEMORY_DB_PATH"] ?? env["LBUG_DB_PATH"] ?? DEFAULT_DB_PATH;
}

export const DB_PATH = resolveDbPath();
