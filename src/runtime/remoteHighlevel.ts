// Remote HighlevelMemoryService: proxies the full contract through the
// owner process's dashboard HTTP API (/api/op). Used when this process could
// not open the embedded DB file because another instance already owns it
// (Ladybug is single-process). No DB handle, no embedder download — the owner
// does the embedding, grounding, and decay.
import type { MemoryEdge, MemoryNode } from "../models/memory.ts";
import type {
  ContradictionResolution,
  HighlevelMemoryService as HighlevelMemoryServiceContract,
  InvalidationResult,
  InvalidationTarget,
  LinkProposal,
  MemoryInspection,
  MemoryLink,
  MemoryStats,
  MemoryTypeFilter,
  ProposeLinksOptions,
  RecallResult,
  RememberLink,
} from "../services/highlevelMemory/index.ts";
import type { MemoryNodeType } from "../models/memory.ts";
import type { OpName } from "../dashboard/protocol.ts";

const DATE_KEYS = new Set(["last_reinforce", "invalidated_at"]);

// Dashboard /api/op returns highlevel objects JSON-encoded, so Dates arrive
// as ISO strings. Revive them in place so downstream serializers (which call
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

export type RemoteHighlevelOptions = {
  baseUrl: string;
  /** fetch timeout per op, ms. */
  timeoutMs?: number;
};

export class RemoteHighlevelMemoryService implements HighlevelMemoryServiceContract {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RemoteHighlevelOptions) {
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

  getTopImportance(type: MemoryTypeFilter, n: number, semanticQuery?: string): Promise<MemoryNode[]> {
    return this.callOp<MemoryNode[]>("getTopImportance", { type, n, semanticQuery });
  }

  recall(initialIdea: string, goalIdea: string, searchHints: string[] = []): Promise<RecallResult> {
    return this.callOp<RecallResult>("recall", { initialIdea, goalIdea, searchHints });
  }

  remember(
    type: MemoryNodeType,
    description: string,
    links: RememberLink[]
  ): Promise<{ node: MemoryNode; edges: MemoryEdge[] }> {
    return this.callOp("remember", { type, description, links });
  }

  proposeLinks(options: ProposeLinksOptions = {}): Promise<LinkProposal[]> {
    return this.callOp<LinkProposal[]>("proposeLinks", {
      focusId: options.focusId,
      limit: options.limit,
    });
  }

  connect(link: MemoryLink): Promise<MemoryEdge> {
    return this.callOp<MemoryEdge>("connect", { ...link });
  }

  invalidate(
    target: InvalidationTarget,
    reason: string,
    supersededBy?: string
  ): Promise<InvalidationResult> {
    return this.callOp<InvalidationResult>("invalidate", { target, reason, supersededBy });
  }

  reinstate(target: InvalidationTarget, reason?: string): Promise<InvalidationResult> {
    return this.callOp<InvalidationResult>("reinstate", { target, reason });
  }

  resolveContradiction(
    keepId: string,
    dropId: string,
    rationale: string,
    evidence?: Record<string, number>
  ): Promise<ContradictionResolution> {
    return this.callOp<ContradictionResolution>("resolveContradiction", {
      keepId,
      dropId,
      rationale,
      evidence,
    });
  }

  challenge(memoryId: string, reason: string): Promise<MemoryNode> {
    return this.callOp<MemoryNode>("challenge", { memoryId, reason });
  }

  corroborate(memoryId: string, reason?: string): Promise<MemoryNode> {
    return this.callOp<MemoryNode>("corroborate", { memoryId, reason });
  }

  reinforce(memoryId: string, strength?: number): Promise<MemoryNode> {
    return this.callOp<MemoryNode>("reinforce", { memoryId, strength });
  }

  inspect(memoryId: string): Promise<MemoryInspection> {
    return this.callOp<MemoryInspection>("inspect", { memoryId });
  }

  stats(): Promise<MemoryStats> {
    return this.callOp<MemoryStats>("stats", {});
  }

  setValidity(memoryId: string, validity: number): Promise<MemoryNode> {
    return this.callOp<MemoryNode>("setValidity", { memoryId, validity });
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
