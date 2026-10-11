import { useMemo } from "react";
import type { MemoryEvent, StateSnapshot } from "../types.ts";

export interface OpRuntime {
  opId: string;
  op: string;
  args: Record<string, unknown>;
  steps: { phase: string; detail: Record<string, unknown>; at: number }[];
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

function deriveOps(events: MemoryEvent[]): OpRuntime[] {
  const ops = new Map<string, OpRuntime>();
  for (const event of events) {
    if (event.type === "op:start") {
      ops.set(event.opId, {
        opId: event.opId,
        op: event.op,
        args: event.args,
        steps: [],
        startedAt: event.at,
      });
    } else if (event.type === "step") {
      ops.get(event.opId)?.steps.push({ phase: event.phase, detail: event.detail, at: event.at });
    } else if (event.type === "op:end") {
      const op = ops.get(event.opId);
      if (op) {
        op.endedAt = event.at;
        op.durationMs = event.durationMs;
        op.result = event.result;
        op.error = event.error;
      }
    }
  }
  return [...ops.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function OperationsTimeline({
  events,
  snapshot,
}: {
  events: MemoryEvent[];
  snapshot: StateSnapshot | null;
}) {
  const ops = useMemo(() => deriveOps(events), [events]);
  const lookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of snapshot?.nodes ?? []) map.set(n.id, n.description);
    return map;
  }, [snapshot]);
  return (
    <div className="panel">
      <h2>Operations ({ops.length})</h2>
      <div className="body">
        {ops.length === 0 && <div className="empty">No operations yet.</div>}
        {ops.slice(0, 40).map((op) => (
          <div key={op.opId} className={`op ${op.error ? "error" : ""}`}>
            <div className="op-head">
              <span className="op-name">
                {op.op} <span className="muted mono">{op.opId.slice(0, 8)}</span>
              </span>
              {op.endedAt ? (
                <span className="dur">{op.durationMs}ms</span>
              ) : (
                <span className="dur">running…</span>
              )}
            </div>
            <div className="op-step">
              <span className="phase">args</span>
              <span className="detail">{formatArgs(op.op, op.args)}</span>
            </div>
            {op.steps.map((step, i) => (
              <div key={i} className="op-step">
                <span className="phase">{step.phase}</span>
                <span className="detail">{summarize(step.phase, step.detail, lookup)}</span>
              </div>
            ))}
            {op.error && (
              <div className="op-step">
                <span className="phase" style={{ color: "var(--contradicts)" }}>
                  error
                </span>
                <span className="detail">{op.error}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function short(id: unknown): string {
  return typeof id === "string" ? id.slice(0, 8) : String(id);
}

function summarize(
  phase: string,
  detail: Record<string, unknown>,
  lookup?: Map<string, string>
): string {
  switch (phase) {
    case "embed": {
      const initial = raw(detail["initial"]);
      const goal = raw(detail["goal"]);
      const hints = Array.isArray(detail["hints"])
        ? (detail["hints"] as unknown[]).map((h) => `“${clip(String(h), 80)}”`).join(", ")
        : "";
      // Back-compat: older servers emitted { goal, hints: count }.
      if (!initial && !goal) return JSON.stringify(detail);
      const hintCount = Array.isArray(detail["hints"])
        ? (detail["hints"] as unknown[]).length
        : typeof detail["hints"] === "number"
          ? (detail["hints"] as number)
          : 0;
      return `initial “${clip(initial || "?", 120)}” → goal “${clip(goal || "?", 120)}”${
        hints ? `  hints[${hintCount}]: ${hints}` : hintCount ? `  hints: ${hintCount}` : ""
      }`;
    }
    case "search": {
      const query = raw(detail["query"]);
      const hits = typeof detail["hits"] === "number" ? detail["hits"] : "?";
      return query ? `“${clip(query, 140)}”  hits: ${hits}` : JSON.stringify(detail);
    }
    case "hop":
      return `${short(detail["fromId"])} → ${short(detail["toId"])}  score ${num(detail["score"])}${describe(
        detail["toId"],
        lookup
      )}`;
    case "ground": {
      const favored = detail["favoredId"] ? `  favored ${short(detail["favoredId"])}` : "";
      return `${detail["edgeType"]}  ${short(detail["fromId"])} → ${short(detail["toId"])}  conf ${num(
        detail["confidence"]
      )}${favored}`;
    }
    case "validity":
      return `${short(detail["id"])}  ${num(detail["from"])} → ${num(detail["to"])}${
        detail["reason"] ? `  “${detail["reason"]}”` : ""
      }`;
    case "invalidated":
      return `${detail["kind"]} ${short(detail["id"])}  “${detail["reason"]}”${
        detail["supersededBy"] ? `  superseded by ${short(detail["supersededBy"])}` : ""
      }`;
    case "reinstated":
      return `${detail["kind"]} ${short(detail["id"])}`;
    case "reinforce":
      return `keep ${short(detail["keepId"] ?? detail["fromId"] ?? detail["edgeId"])}  ${
        detail["importance"] !== undefined ? `importance ${num(detail["importance"])}` : ""
      }`;
    case "reinforced":
      return `${short(detail["id"])}  importance ${num(detail["importance"])}`;
    case "anchors":
    case "goals": {
      const query = raw(detail["query"]);
      const base = ids(detail["ids"], lookup);
      return query ? `“${clip(query, 140)}”  → ${base}` : base;
    }
    case "rank":
      return ids(detail["ids"], lookup);
    case "candidates":
      return `${ids(detail["ids"], lookup)}  pairs ${Array.isArray(detail["pairs"]) ? detail["pairs"].length : 0}`;
    case "node":
      return `${short(detail["id"])}  ${detail["type"]}  “${String(detail["description"] ?? "").slice(0, 60)}”`;
    case "edge":
      return `${short(detail["edgeId"])}  ${detail["edgeType"]}  ${short(detail["fromId"])} → ${short(
        detail["toId"]
      )}`;
    case "linked":
      return `${short(detail["edgeId"])}  ${detail["edgeType"]}  ${short(detail["fromId"])} → ${short(
        detail["toId"]
      )}`;
    default:
      return JSON.stringify(detail);
  }
}

function ids(value: unknown, lookup?: Map<string, string>): string {
  if (!Array.isArray(value)) return "";
  const parts = value.map((v) => {
    const id = short(v);
    if (!lookup || typeof v !== "string") return id;
    const desc = lookup.get(v);
    return desc ? `${id} “${clip(desc, 48)}”` : id;
  });
  return `${value.length} [${parts.join(", ")}]`;
}

function num(value: unknown): string {
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

function raw(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function describe(id: unknown, lookup?: Map<string, string>): string {
  if (typeof id !== "string" || !lookup) return "";
  const desc = lookup.get(id);
  return desc ? `  “${clip(desc, 60)}”` : "";
}

function formatArgs(op: string, args: Record<string, unknown>): string {
  switch (op) {
    case "recall": {
      const initial = raw(args["initialIdea"]);
      const goal = raw(args["goalIdea"]);
      const hints = Array.isArray(args["searchHints"])
        ? (args["searchHints"] as unknown[]).map((h) => String(h)).filter(Boolean)
        : [];
      return `initial “${clip(initial || "?", 140)}” → goal “${clip(goal || "?", 140)}”${
        hints.length ? `  hints: ${hints.map((h) => `“${clip(h, 60)}”`).join(", ")}` : ""
      }`;
    }
    case "getTopImportance": {
      const query = raw(args["semanticQuery"]);
      return `type=${String(args["type"] ?? "?")} n=${String(args["n"] ?? "?")}${
        query ? `  query “${clip(query, 160)}”` : ""
      }`;
    }
    case "remember":
      return `type=${String(args["type"] ?? "?")}  “${clip(raw(args["description"]), 180)}”`;
    case "proposeLinks": {
      const focus = raw(args["focusId"]);
      return focus ? `focus ${short(focus)}` : "buffer";
    }
    default:
      return clip(JSON.stringify(args), 280);
  }
}
