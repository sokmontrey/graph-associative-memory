// Remote MemoryTools: proxies the low-level contract through the owner
// process's dashboard HTTP API (/api/op). Used when this process could not
// open the embedded DB file because another instance already owns it
// (Ladybug is single-process). No DB handle, no embedder download.
import type { MemoryEdge, MemoryNode, MemoryTools } from "../models/memory-graph.ts";
import type { OpName } from "../dashboard/protocol.ts";

const DATE_KEYS = new Set(["createdAt", "lastReinforcedAt"]);

// Dashboard /api/op returns objects JSON-encoded, so Dates arrive as ISO
// strings. Revive them in place so downstream serializers (which call
// .toISOString()) keep working.
function reviveDates(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = reviveDates(value[i]);
    return value;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if (DATE_KEYS.has(key) && typeof entry === "string") {
        const date = new Date(entry);
        record[key] = Number.isNaN(date.getTime()) ? null : date;
      } else {
        record[key] = reviveDates(entry);
      }
    }
    return record;
  }
  return value;
}

export type RemoteMemoryOptions = {
  baseUrl: string;
  /** fetch timeout per op, ms. */
  timeoutMs?: number;
};

export class RemoteMemoryService implements MemoryTools {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RemoteMemoryOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async callOp<T>(op: OpName, args: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/op`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, args }),
        signal: controller.signal,
      });
      const body = (await response.json()) as
        | { ok: true; result: unknown }
        | { ok?: undefined; error: string };
      if (!response.ok || !("ok" in body) || body.ok !== true) {
        const message =
          "error" in body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
        throw new Error(`remote ${op} failed: ${message}`);
      }
      return reviveDates(body.result) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  search(query: string, n?: number): Promise<MemoryNode[]> {
    return this.callOp<MemoryNode[]>("search", { query, n });
  }

  recent(n?: number, kind?: string): Promise<MemoryNode[]> {
    return this.callOp<MemoryNode[]>("recent", { n, kind });
  }

  top(n?: number): Promise<MemoryNode[]> {
    return this.callOp<MemoryNode[]>("top", { n });
  }

  get(ids: string[]): Promise<MemoryNode[]> {
    return this.callOp<MemoryNode[]>("get", { ids });
  }

  edges(
    nodeId: string,
    opts: { relation?: string; query?: string; n?: number } = {}
  ): Promise<MemoryEdge[]> {
    return this.callOp<MemoryEdge[]>("edges", { nodeId, ...opts });
  }

  add(input: { content: string; kind: string }): Promise<MemoryNode> {
    return this.callOp<MemoryNode>("add", { ...input });
  }

  update(id: string, patch: { content?: string; kind?: string }): Promise<MemoryNode> {
    return this.callOp<MemoryNode>("update", { id, ...patch });
  }

  link(input: { from: string; to: string; relation: string; description: string }): Promise<MemoryEdge> {
    return this.callOp<MemoryEdge>("link", { ...input });
  }

  async forget(ids: string[]): Promise<void> {
    await this.callOp("forget", { ids });
  }

  async reinforceNodes(ids: string[], amount?: number): Promise<void> {
    await this.callOp("reinforceNodes", { ids, amount });
  }

  async reinforceEdges(ids: string[], amount?: number): Promise<void> {
    await this.callOp("reinforceEdges", { ids, amount });
  }
}

/** Probe whether an owner dashboard is already serving on baseUrl. */
export async function probeOwner(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
