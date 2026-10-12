import { Brain, Loader2 } from "lucide-react";
import { Badge } from "./ui/badge.tsx";
import { Separator } from "./ui/separator.tsx";
import { cn } from "@/lib/utils";
import type { StateSnapshot } from "../types.ts";

export function StatsBar({
  snapshot,
  connected,
  busy,
}: {
  snapshot: StateSnapshot | null;
  connected: boolean;
  busy?: boolean;
}) {
  const stats = snapshot?.stats;
  const typeEntries = stats
    ? (Object.entries(stats.byNodeType) as [string, number][]).filter(([, n]) => n > 0)
    : [];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Brain className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">Associative Memory</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? "bg-emerald-500" : "bg-destructive"
              )}
            />
            {connected ? "live" : "disconnected"}
            {busy && (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> working
              </span>
            )}
          </div>
        </div>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <Stat label="memories" value={String(stats?.nodes.total ?? 0)} />
        <Stat label="links" value={String(stats?.edges.total ?? 0)} />
        <Stat
          label="avg rank"
          value={((stats?.nodes.avgImportance ?? 0) * (stats?.nodes.avgValidity ?? 0)).toFixed(2)}
        />
        <Stat label="validity" value={(stats?.nodes.avgValidity ?? 0).toFixed(2)} />
        {(stats?.nodes.invalidated ?? 0) > 0 && (
          <Badge variant="destructive">{stats?.nodes.invalidated} invalidated</Badge>
        )}
        {typeEntries.map(([t, n]) => (
          <Badge key={t} variant="outline" className="gap-1 normal-case">
            <Dot type={t} />
            {t} · {n}
          </Badge>
        ))}
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-xs">
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Dot({ type }: { type: string }) {
  const color =
    type === "preference"
      ? "bg-violet-400"
      : type === "trait"
        ? "bg-teal-400"
        : "bg-orange-400";
  return <span className={cn("h-1.5 w-1.5 rounded-full", color)} />;
}
