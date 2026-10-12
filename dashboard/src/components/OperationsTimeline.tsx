import { useMemo } from "react";
import { Activity, AlertCircle, ChevronRight } from "lucide-react";
import type { MemoryEvent, StateSnapshot } from "../types.ts";
import { Badge } from "./ui/badge.tsx";
import { cn } from "@/lib/utils";

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

/** Node ids an operation touched, for filtered graph views. */
export function opNodeIds(op: OpRuntime, snapshot: StateSnapshot | null): string[] {
  const ids = new Set<string>();
  const edgeById = new Map((snapshot?.edges ?? []).map((e) => [e.id, e]));
  const add = (id: unknown) => {
    if (typeof id === "string" && id) ids.add(id);
  };
  const addEdgeEnds = (edgeId: unknown) => {
    const e = typeof edgeId === "string" ? edgeById.get(edgeId) : undefined;
    if (e) {
      ids.add(e.from);
      ids.add(e.to);
    }
  };
  for (const step of op.steps) {
    const d = step.detail;
    for (const key of ["ids", "pairs"]) {
      const v = d[key];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") add(item);
          else if (Array.isArray(item)) for (const sub of item) add(sub);
        }
      }
    }
    add(d["id"]);
    add(d["nodeId"]);
    add(d["keepId"]);
    add(d["focusId"]);
    add(d["fromId"]);
    add(d["toId"]);
    add(d["favoredId"]);
    add(d["supersededBy"]);
    addEdgeEnds(d["edgeId"]);
    const pairs = d["pairs"];
    if (Array.isArray(pairs)) {
      for (const p of pairs) {
        if (p && typeof p === "object") {
          add((p as Record<string, unknown>)["fromId"]);
          add((p as Record<string, unknown>)["toId"]);
        }
      }
    }
  }
  return [...ids];
}

export function OperationsTimeline({
  events,
  snapshot,
  selectedOpId,
  onSelect,
}: {
  events: MemoryEvent[];
  snapshot: StateSnapshot | null;
  selectedOpId: string | null;
  onSelect: (opId: string | null) => void;
}) {
  const ops = useMemo(() => deriveOps(events), [events]);
  const lookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of snapshot?.nodes ?? []) map.set(n.id, n.description);
    return map;
  }, [snapshot]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Operations
        </span>
        <Badge variant="secondary">{ops.length}</Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">click to filter graph</span>
      </div>
      {ops.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No operations yet. Run something from control.
        </div>
      )}
      <div className="space-y-1.5">
        {ops.slice(0, 40).map((op) => {
          const selected = op.opId === selectedOpId;
          return (
            <button
              key={op.opId}
              type="button"
              onClick={() => onSelect(selected ? null : op.opId)}
              className={cn(
                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer",
                selected
                  ? "border-primary/50 bg-accent"
                  : "border-border bg-background/60 hover:border-ring hover:bg-accent/60",
                op.error && "border-destructive/40"
              )}
            >
              <div className="flex items-center gap-2">
                {op.error ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-[13px] font-medium">{op.op}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{op.opId.slice(0, 8)}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {op.endedAt ? `${op.durationMs}ms` : "running…"}
                </span>
                <ChevronRight
                  className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", selected && "rotate-90")}
                />
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {formatArgs(op.op, op.args)}
              </div>
              {selected && (
                <div className="mt-2 space-y-1 border-t border-border pt-2">
                  {op.steps.map((step, i) => (
                    <div key={i} className="grid grid-cols-[72px_1fr] gap-2 text-[11px]">
                      <span className="font-semibold text-sky-500">{step.phase}</span>
                      <span className="break-words font-mono text-muted-foreground">
                        {summarize(step.phase, step.detail, lookup)}
                      </span>
                    </div>
                  ))}
                  {op.error && <div className="text-[11px] text-destructive">{op.error}</div>}
                  {op.steps.length === 0 && (
                    <div className="text-[11px] text-muted-foreground">no steps recorded</div>
                  )}
                </div>
              )}
            </button>
          );
        })}
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
      const kept = typeof detail["kept"] === "number" ? `  kept: ${detail["kept"]}` : "";
      return query ? `“${clip(query, 140)}”  hits: ${hits}${kept}` : JSON.stringify(detail);
    }
    case "searchFallback": {
      const query = raw(detail["query"]);
      const hits = typeof detail["hits"] === "number" ? detail["hits"] : "?";
      return query ? `lexical fallback “${clip(query, 140)}”  hits: ${hits}` : JSON.stringify(detail);
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
