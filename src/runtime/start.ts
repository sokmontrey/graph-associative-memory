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
    "[memory] if it is corrupt, or was built by a different embedder, remove it " +
      "(e.g. `rm -rf data/ladybug data/ladybug.wal`) and start again."
  );
  process.exit(1);
}

let dashboard: DashboardServer | null = null;
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
  await stack.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
