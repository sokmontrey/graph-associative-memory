import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryStack } from "../index.ts";
import type { MemoryEvent } from "../services/highlevelMemory/events.ts";
import { buildSnapshot } from "./state.ts";
import type { OpRequest } from "./protocol.ts";

export type DashboardServerOptions = {
  stack: MemoryStack;
  port?: number;
  host?: string;
  /** Built dashboard assets; defaults to <project>/dashboard/dist. */
  distDir?: string;
};

export type DashboardServer = {
  server: Server;
  url: string;
  close(): Promise<void>;
};

const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dashboard", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function dispatch(stack: MemoryStack, req: OpRequest): Promise<unknown> {
  const { highlevel } = stack;
  const args = req.args ?? {};
  switch (req.op) {
    case "getTopImportance":
      return highlevel.getTopImportance(
        args["type"] as never,
        Number(args["n"]),
        args["semanticQuery"] as string | undefined
      );
    case "recall":
      return highlevel.recall(
        String(args["initialIdea"]),
        String(args["goalIdea"]),
        (args["searchHints"] as string[] | undefined) ?? []
      );
    case "remember":
      return highlevel.remember(
        args["type"] as never,
        String(args["description"]),
        (args["links"] as never[]) ?? []
      );
    case "proposeLinks":
      return highlevel.proposeLinks({
        focusId: args["focusId"] as string | undefined,
        limit: args["limit"] as number | undefined,
      });
    case "connect":
      return highlevel.connect(args as never);
    case "reinforce":
      return highlevel.reinforce(String(args["memoryId"]), args["strength"] as number | undefined);
    case "challenge":
      return highlevel.challenge(String(args["memoryId"]), String(args["reason"]));
    case "corroborate":
      return highlevel.corroborate(
        String(args["memoryId"]),
        args["reason"] as string | undefined
      );
    case "invalidate":
      return highlevel.invalidate(
        args["target"] as never,
        String(args["reason"]),
        args["supersededBy"] as string | undefined
      );
    case "reinstate":
      return highlevel.reinstate(args["target"] as never, args["reason"] as string | undefined);
    case "resolveContradiction":
      return highlevel.resolveContradiction(
        String(args["keepId"]),
        String(args["dropId"]),
        String(args["rationale"]),
        args["evidence"] as Record<string, number> | undefined
      );
    default:
      return Promise.reject(new Error(`unknown op ${JSON.stringify(req.op)}`));
  }
}

/**
 * HTTP + SSE surface for the dashboard, served from the same process that owns
 * the (single-process) database. Never logs to stdout — that channel belongs to
 * the MCP stdio transport.
 */
export async function createDashboardServer(
  options: DashboardServerOptions
): Promise<DashboardServer> {
  const { stack } = options;
  const distDir = options.distDir ?? DEFAULT_DIST;
  const clients = new Set<ServerResponse>();

  const broadcast = (event: MemoryEvent) => {
    const frame = `event: memory\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(frame);
  };
  const unsubscribe = stack.events.subscribe(broadcast);
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 15000);

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      console.error(`dashboard: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: String(error) });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/api/state") {
      return sendJson(res, 200, await buildSnapshot(stack));
    }

    if (path === "/api/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
      clients.add(res);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    if (path === "/api/op" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as OpRequest;
      const result = await dispatch(stack, body);
      return sendJson(res, 200, { ok: true, op: body.op, result });
    }

    if (path === "/api/tick" && req.method === "POST") {
      await stack.service.tick();
      return sendJson(res, 200, { ok: true });
    }

    if (path === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }

    if (path.startsWith("/api/")) {
      return sendJson(res, 404, { error: "not found" });
    }

    // Static assets with SPA fallback.
    const target = path === "/" ? "/index.html" : path;
    const filePath = join(distDir, target);
    if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: "forbidden" });
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      try {
        const index = await readFile(join(distDir, "index.html"));
        res.writeHead(200, { "content-type": MIME[".html"]! });
        res.end(index);
      } catch {
        res.writeHead(200, { "content-type": MIME[".html"]! });
        res.end(
          `<h1>Dashboard not built</h1><p>Run <code>npm run dashboard:build</code>, or ` +
            `<code>npm run dashboard:dev</code> for the Vite dev server (API proxied here).</p>`
        );
      }
    }
  }

  const port = options.port ?? 4317;
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolveListen, rejectListen) => {
    // listen() reports failures (e.g. EADDRINUSE) via an 'error' event, not by
    // throwing — surface it as a rejection so the caller can keep MCP running.
    const onError = (error: Error) => rejectListen(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    url: `http://${host}:${actualPort}`,
    async close() {
      clearInterval(heartbeat);
      unsubscribe();
      for (const client of clients) client.end();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}
