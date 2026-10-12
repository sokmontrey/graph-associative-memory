import type { MemoryEvent } from "../types.ts";
import { Badge } from "./ui/badge.tsx";
import { cn } from "@/lib/utils";

export function EventLog({ events }: { events: MemoryEvent[] }) {
  const shown = events.slice(-200).reverse();
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Events
        </span>
        <Badge variant="secondary">{events.length}</Badge>
      </div>
      <div className="max-h-56 overflow-y-auto nice-scroll rounded-lg border border-border bg-background/60 font-mono text-[11px]">
        {shown.length === 0 && (
          <div className="px-3 py-4 text-center text-muted-foreground">no events yet</div>
        )}
        {shown.map((event, i) => (
          <div key={i} className="flex items-baseline gap-1.5 border-b border-border/50 px-2.5 py-1 last:border-0">
            <span className={cn("h-1.5 w-1.5 shrink-0 self-center rounded-full", dot(event))} />
            <span className="shrink-0 text-foreground/90">{event.type}</span>
            {"phase" in event ? <span className="shrink-0 text-sky-500">{event.phase}</span> : null}
            {"op" in event ? <span className="shrink-0 text-muted-foreground">{event.op}</span> : null}
            <span className="truncate text-muted-foreground">{summarize(event)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function dot(event: MemoryEvent): string {
  if (event.type === "db:changed") return "bg-emerald-500";
  if (event.type === "op:end") return event.error ? "bg-destructive" : "bg-muted-foreground";
  if (event.type === "op:start") return "bg-amber-400";
  return "bg-sky-500";
}

function summarize(event: MemoryEvent): string {
  if (event.type === "db:changed") return event.reason;
  if (event.type === "op:start") return JSON.stringify(event.args).slice(0, 320);
  if (event.type === "op:end") return event.error ?? `${event.durationMs}ms`;
  return JSON.stringify(event.detail).slice(0, 320);
}
