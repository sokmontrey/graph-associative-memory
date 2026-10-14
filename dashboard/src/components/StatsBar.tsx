import { Brain, Loader2 } from "lucide-react";
import { Badge } from "./ui/badge.tsx";
import { Separator } from "./ui/separator.tsx";
import { cn } from "@/lib/utils";
import type { StateSnapshot } from "../types.ts";

const DOT_COLORS = [
  "bg-violet-400",
  "bg-teal-400",
  "bg-orange-400",
  "bg-sky-400",
  "bg-rose-400",
  "bg-lime-400",
];

function dotColor(kind: string): string {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) | 0;
  return DOT_COLORS[Math.abs(h) % DOT_COLORS.length]!;
}

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
  const kindEntries = stats?.byKind
    ? (Object.entries(stats.byKind) as [string, number][]).filter(([, n]) => n > 0)
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
        <Stat label="memories" value={String(stats?.nodes ?? 0)} />
        <Stat label="links" value={String(stats?.edges ?? 0)} />
        <Stat label="avg importance" value={(stats?.avgImportance ?? 0).toFixed(2)} />
        <Stat label="avg strength" value={(stats?.avgStrength ?? 0).toFixed(2)} />
        {kindEntries.map(([t, n]) => (
          <Badge key={t} variant="outline" className="gap-1 normal-case">
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColor(t))} />
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
