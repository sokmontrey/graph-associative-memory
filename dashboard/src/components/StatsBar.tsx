import type { StateSnapshot } from "../types.ts";

export function StatsBar({
  snapshot,
  connected,
}: {
  snapshot: StateSnapshot | null;
  connected: boolean;
}) {
  const stats = snapshot?.stats;
  return (
    <div className="panel">
      <div className="stats">
        <span className="chip" style={{ color: connected ? "var(--supports)" : "var(--contradicts)" }}>
          {connected ? "live" : "disconnected"}
        </span>
        <Stat k="Memories" v={stats?.nodes.total ?? 0} />
        <Stat k="Active" v={stats?.nodes.active ?? 0} />
        <Stat k="Invalidated" v={stats?.nodes.invalidated ?? 0} />
        <Stat k="Links" v={stats?.edges.total ?? 0} />
        <Stat k="Avg rank" v={fmt(stats?.nodes.avgImportance, stats?.nodes.avgValidity)} />
        <Stat k="Avg validity" v={(stats?.nodes.avgValidity ?? 0).toFixed(2)} />
        <span className="muted" style={{ marginLeft: "auto" }}>
          {stats
            ? Object.entries(stats.byNodeType)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${t}:${n}`)
                .join("  ")
            : ""}
        </span>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function fmt(importance?: number, validity?: number): string {
  if (importance === undefined || validity === undefined) return "0.00";
  return (importance * validity).toFixed(2);
}
