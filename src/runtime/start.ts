import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { DB_PATH } from "../db/index.ts";
import { createMemoryStack } from "../index.ts";
import { createDashboardServer, type DashboardServer } from "../dashboard/server.ts";
import { createMemoryMcpServer } from "../mcp/server.ts";

// One process owns the embedded (single-process) database, serving the MCP
// tools over stdio and the dashboard over HTTP/SSE at the same time.
const port = Number(process.env["MEMORY_PORT"] ?? 4317);
const enableMcp = process.env["MEMORY_MCP"] !== "0";
const enableDashboard = process.env["MEMORY_DASHBOARD"] !== "0";

// Embedder is EmbeddingGemma-300M; its ~300 MB model downloads once on first
// use, then runs offline.
let stack: Awaited<ReturnType<typeof createMemoryStack>>;
try {
  stack = await createMemoryStack({ dbPath: DB_PATH });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[memory] cannot open the database at ${DB_PATH}: ${message}`);
  console.error(
    "[memory] a backup of data/ladybug (+ .wal) may let you retry; " +
      "tolerant WAL replay already runs automatically, so a repeat of this " +
      "error is not a torn WAL — inspect the message before deleting anything."
  );
  process.exit(1);
}

let dashboard: DashboardServer | null = null;
// memory_propose_links is the only op needing credentials; warn once instead
// of failing late with a bare missing-key error (todo b5af1b54).
if (!process.env["TYPESAFE_API_KEY"]) {
  console.error(
    "[memory] TYPESAFE_API_KEY is not set — memory_propose_links will fail; " +
      "set it in .env (repo root, see .env.example) or the host environment."
  );
}
if (enableDashboard) {
  try {
    dashboard = await createDashboardServer({ stack, port });
    console.error(`[memory] dashboard: ${dashboard.url}`);
  } catch (error) {
    // A busy port must not take the MCP server down with it.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[memory] dashboard disabled (port ${port}): ${message}`);
  }
}

let mcpHandle: { close(): Promise<void> } | null = null;
if (enableMcp) {
  mcpHandle = serveStdio(() =>
    createMemoryMcpServer({
      highlevel: stack.highlevel,
      service: stack.service,
      events: stack.events,
    })
  );
  console.error("[memory] mcp: stdio");
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[memory] shutting down (${signal})`);
  if (dashboard) await dashboard.close();
  if (mcpHandle) await mcpHandle.close();
  // Checkpoint before closing so an abrupt death later has less WAL to lose.
  // (db.close() also flushes, but an explicit CHECKPOINT seals it first.)
  try {
    await stack.db.query("CHECKPOINT");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[memory] checkpoint on shutdown failed: ${message}`);
  }
  await stack.close();
  process.exit(signal.startsWith("fatal:") ? 1 : 0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// The host may kill the stdio child without SIGINT/SIGTERM (close/reopen).
// These cover the remaining abrupt-death paths a single-process embedded DB
// must survive: hangup, quit, broken stdout pipe, orphaning, and fatal errors
// (which checkpoint before exiting nonzero).
process.on("SIGHUP", () => void shutdown("SIGHUP"));
process.on("SIGQUIT", () => void shutdown("SIGQUIT"));
process.on("SIGPIPE", () => void shutdown("SIGPIPE"));
// Orphan watch: if our parent dies without signalling us, we get reparented
// (ppid becomes 1) while still holding the database lock and dashboard port —
// which would brick the next launch. Poll for that and bow out cleanly.
// (stdin 'end'/'close' is deliberately NOT used: incidental pipes and
// /dev/null reach EOF immediately and would kill a healthy server.)
const parentPidAtStart = process.ppid;
let orphanTimer: NodeJS.Timeout | null = null;
if (parentPidAtStart !== 1) {
  orphanTimer = setInterval(() => {
    if (!shuttingDown && process.ppid === 1) void shutdown("orphan");
  }, 5000);
  orphanTimer.unref();
}
process.on("uncaughtException", (error) => {
  console.error(`[memory] uncaught exception: ${error instanceof Error ? error.message : String(error)}`);
  void shutdown("fatal:uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error(`[memory] unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  void shutdown("fatal:unhandledRejection");
});
