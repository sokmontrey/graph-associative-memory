import type { MemoryEvent } from "../types.ts";

const PHASE_COLOR: Record<string, string> = {};

export function EventLog({ events }: { events: MemoryEvent[] }) {
  const shown = events.slice(-200).reverse();
  return (
    <div className="panel">
      <h2>Raw event stream ({events.length})</h2>
      <div className="body log">
        {shown.length === 0 && <div className="empty">no events yet</div>}
        {shown.map((event, i) => (
          <div key={i}>
            <span style={{ color: color(event) }}>{event.type}</span>{" "}
            {"phase" in event ? <span>{event.phase} </span> : null}
            {"op" in event ? <span className="muted">{event.op} </span> : null}
            <span className="muted">{summarize(event)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function color(event: MemoryEvent): string {
  if (event.type === "db:changed") return "var(--supports)";
  if (event.type === "op:end") return event.error ? "var(--contradicts)" : "var(--muted)";
  if (event.type === "op:start") return "var(--evokes)";
  return PHASE_COLOR[event.phase] ?? "var(--related_to)";
}

function summarize(event: MemoryEvent): string {
  if (event.type === "db:changed") return event.reason;
  if (event.type === "op:start") return JSON.stringify(event.args).slice(0, 320);
  if (event.type === "op:end") return event.error ?? `${event.durationMs}ms`;
  return JSON.stringify(event.detail).slice(0, 320);
}
