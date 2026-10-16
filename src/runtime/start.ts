import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { DB_PATH } from "../db/index.ts";
import { createMemoryStack } from "../stack.ts";
import { createDashboardServer, type DashboardServer } from "../dashboard/server.ts";
import { createMemoryMcpServer } from "../mcp/server.ts";
import type { MemoryTools } from "../models/memory-graph.ts";
import { probeOwner, RemoteMemoryService } from "./remoteMemory.ts";

// Process entry: one process owns the embedded (single-process) database,
// serving MCP over stdio and the dashboard over HTTP/SSE together. Any
// further process that cannot open the DB file (second OpenCode window,
// another harness) does NOT crash: it probes the owner's dashboard and
// serves the same MCP tools as a remote HTTP client instead.
const port = Number(process.env["MEMORY_PORT"] ?? 4317);
const enableMcp = process.env["MEMORY_MCP"] !== "0";
const enableDashboard = process.env["MEMORY_DASHBOARD"] !== "0";
const ownerBaseUrl =
  process.env["MEMORY_OWNER_URL"] ?? `http://127.0.0.1:${port}`;

type OwnedResources = {
  mode: "owner";
  stack: Awaited<ReturnType<typeof createMemoryStack>>;
  dashboard: DashboardServer | null;
};

type RemoteResources = {
  mode: "remote";
  service: MemoryTools;
};

let owned: OwnedResources | null = null;
let remote: RemoteResources | null = null;

async function boot(): Promise<OwnedResources | RemoteResources | null> {
  // Embedder is EmbeddingGemma-300M; its ~300 MB model downloads once on first
  // use, then runs offline. Remote mode never touches it.
  try {
    const stack = await createMemoryStack({ dbPath: DB_PATH });
    return { mode: "owner", stack, dashboard: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[memory] cannot open the database at ${DB_PATH}: ${message}`);
    // Before giving up, check whether another instance already owns the DB
    // and serves the dashboard — if so, become a remote MCP client of it.
    if (await probeOwner(ownerBaseUrl)) {
      console.error(
        `[memory] database is owned by another instance — ` +
          `serving MCP as a remote client of ${ownerBaseUrl} (no local DB handle)`
      );
      return { mode: "remote", service: new RemoteMemoryService({ baseUrl: ownerBaseUrl }) };
    }
    console.error(
      "[memory] no owner dashboard answered at " +
        `${ownerBaseUrl}/healthz, so remote fallback is unavailable. ` +
        "If another instance holds the DB lock, keep its dashboard enabled " +
        "(MEMORY_DASHBOARD=1); otherwise a backup of data/ladybug (+ .wal) may " +
        "let you retry. Tolerant WAL replay already runs automatically, so a " +
        "repeat of this error is not a torn WAL — inspect the message before " +
        "deleting anything."
    );
    process.exit(1);
    return null;
  }
}

const resources = await boot();
if (resources?.mode === "owner") {
  owned = resources;
  // No schedule, no cron: decay is driven purely by traffic — every
  // OPS_PER_TICK tool calls land one decay step inside the service.
  if (enableDashboard) {
    try {
      owned.dashboard = await createDashboardServer({ stack: owned.stack, port });
      console.error(`[memory] dashboard: ${owned.dashboard.url}`);
    } catch (error) {
      // A busy port must not take the MCP server down with it.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[memory] dashboard disabled (port ${port}): ${message}`);
    }
  }
} else if (resources?.mode === "remote") {
  remote = resources;
  if (enableDashboard) {
    console.error(
      `[memory] remote mode: dashboard is served by the owner at ${ownerBaseUrl}; ` +
        `not starting a local one.`
    );
  }
  // Owner-failover watchdog: remote mode proxies every op through the owner's
  // dashboard, so a dead owner means every tool call fails with fetch errors
  // while this process looks healthy. Re-probe periodically; after consecutive
  // failures, exit so the host respawns us and the fresh boot retries opening
  // the DB as owner (the single-process lock decides, so no split-brain).
  let missed = 0;
  const watchdog = setInterval(() => {
    void probeOwner(ownerBaseUrl).then((alive) => {
      if (shuttingDown) return;
      if (alive) {
        missed = 0;
        return;
      }
      missed++;
      console.error(`[memory] owner unreachable (${missed}/3)`);
      if (missed >= 3) {
        clearInterval(watchdog);
        void shutdown("owner-gone");
      }
    });
  }, 10000);
  watchdog.unref();
}

let mcpHandle: { close(): Promise<void> } | null = null;
if (enableMcp) {
  if (owned) {
    const { stack } = owned;
    mcpHandle = serveStdio(() => createMemoryMcpServer({ service: stack.service }));
    console.error("[memory] mcp: stdio (owner)");
  } else if (remote) {
    // Remote mode holds no DB handle: the owner does the embedding and decay.
    // createMemoryMcpServer only needs the MemoryTools surface, so a remote
    // service is sufficient. tick() is owner-only by design.
    const { service } = remote;
    mcpHandle = serveStdio(() => createMemoryMcpServer({ service }));
    console.error("[memory] mcp: stdio (remote)");
  }
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[memory] shutting down (${signal})`);
  if (owned?.dashboard) await owned.dashboard.close();
  if (mcpHandle) await mcpHandle.close();
  if (owned) {
    // Checkpoint before closing so an abrupt death later has less WAL to lose.
    // (db.close() also flushes, but an explicit CHECKPOINT seals it first.)
    try {
      await owned.stack.db.query("CHECKPOINT");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[memory] checkpoint on shutdown failed: ${message}`);
    }
    await owned.stack.close();
  }
  // Remote mode holds no DB handle or port: nothing else to release, so a
  // second harness exiting can never corrupt the owner's WAL.
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
// Remote clients hold neither lock nor port, but exiting on orphan still
// avoids piling up stale stdio proxies.
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
