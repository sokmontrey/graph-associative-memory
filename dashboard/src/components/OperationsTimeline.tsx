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
    const list = d["ids"];
    if (Array.isArray(list)) {
      for (const item of list) add(item);
    }
    add(d["id"]);
    add(d["nodeId"]);
    add(d["fromId"]);
    add(d["from"]);
    add(d["toId"]);
    add(d["to"]);
    addEdgeEnds(d["edgeId"]);
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
    for (const n of snapshot?.nodes ?? []) map.set(n.id, n.content);
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
    case "relevant": {
      const hits = typeof detail["hits"] === "number" ? detail["hits"] : "?";
      const kept = typeof detail["kept"] === "number" ? `  kept: ${detail["kept"]}` : "";
      return `hits: ${hits}${kept}`;
    }
    case "fallback": {
      const query = raw(detail["query"]);
      const hits = typeof detail["hits"] === "number" ? detail["hits"] : "?";
      return query ? `lexical fallback “${clip(query, 140)}”  hits: ${hits}` : JSON.stringify(detail);
    }
    case "dedup":
      return `near-duplicate ${short(detail["id"])} — reinforced instead`;
    case "upsert":
      return `existing ${short(detail["id"])} — reinforced instead`;
    case "node":
      return `${short(detail["id"])}${detail["kind"] ? `  ${String(detail["kind"])}` : ""}`;
    case "edge": {
      const id = short(detail["id"] ?? detail["edgeId"]);
      const rel = String(detail["relation"] ?? detail["edgeType"] ?? "");
      return `${id}  ${rel}  ${short(detail["from"] ?? detail["fromId"])} → ${short(detail["to"] ?? detail["toId"])}`;
    }
    default:
      return JSON.stringify(detail);
  }
}

function raw(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function formatArgs(op: string, args: Record<string, unknown>): string {
  switch (op) {
    case "search":
      return `“${clip(raw(args["query"]), 180)}”  n=${String(args["n"] ?? 10)}`;
    case "recent":
      return `n=${String(args["n"] ?? 10)}${args["kind"] ? `  kind=${String(args["kind"])}` : ""}`;
    case "add":
      return `${String(args["kind"] ?? "?")}  “${clip(raw(args["content"]), 180)}”`;
    case "link":
      return `${String(args["relation"] ?? "?")}  ${short(args["from"])} → ${short(args["to"])}`;
    default:
      return clip(JSON.stringify(args), 280);
  }
}
