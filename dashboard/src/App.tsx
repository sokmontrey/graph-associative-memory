import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Eraser, PanelLeftClose, PanelRightClose, X } from "lucide-react";
import { fetchState, runOp, subscribe } from "./api.ts";
import type { MemoryEvent, OpName, StateSnapshot } from "./types.ts";
import { StatsBar } from "./components/StatsBar.tsx";
import { GraphView, type Overlays } from "./components/GraphView.tsx";
import { OperationsTimeline, opNodeIds } from "./components/OperationsTimeline.tsx";
import { Inspector, type Selection } from "./components/Inspector.tsx";
import { SemanticSearch } from "./components/SemanticSearch.tsx";
import { Controls } from "./components/Controls.tsx";
import { EventLog } from "./components/EventLog.tsx";
import { Button } from "./components/ui/button.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { ScrollArea } from "./components/ui/scroll-area.tsx";

const EMPTY_OVERLAYS: Overlays = { highlightNodes: [], highlightEdges: [] };

function union(list: string[], extra: string[]): string[] {
  const set = new Set(list);
  for (const item of extra) set.add(item);
  return [...set];
}

// Collect node/edge ids from an op result so the graph can highlight them.
function idsFromResult(result: unknown, snapshot: StateSnapshot | null): { nodes: string[]; edges: string[] } {
  const nodes: string[] = [];
  const edges: string[] = [];
  const edgeById = new Map((snapshot?.edges ?? []).map((e) => [e.id, e]));
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record["id"] === "string") {
      const id = record["id"] as string;
      if (typeof record["content"] === "string") nodes.push(id);
      else if (typeof record["relation"] === "string") {
        edges.push(id);
        const e = edgeById.get(id);
        if (e) nodes.push(e.from, e.to);
      } else nodes.push(id);
    }
    if (typeof record["from"] === "string" && typeof record["to"] === "string") {
      nodes.push(record["from"], record["to"]);
    }
  };
  visit(result);
  return { nodes: [...new Set(nodes)], edges: [...new Set(edges)] };
}

export function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [overlays, setOverlays] = useState<Overlays>(EMPTY_OVERLAYS);
  const [filter, setFilter] = useState<{ label: string; ids: Set<string> } | null>(null);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [prevSnapshot, setPrevSnapshot] = useState<StateSnapshot | null>(null);
  const snapshotRef = useRef<StateSnapshot | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetchTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchState();
      setPrevSnapshot(snapshotRef.current);
      snapshotRef.current = next;
      setSnapshot(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const close = subscribe(
      (event) => {
        setEvents((prev) => [...prev.slice(-599), event]);
        if (event.type === "db:changed") {
          if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
          refetchTimer.current = window.setTimeout(() => void refresh(), 120);
        }
      },
      setConnected
    );
    return () => {
      close();
      if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    };
  }, [refresh]);

  const onRun = useCallback(
    async (op: OpName, args: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const result = (await runOp(op, args)) as unknown;
        const { nodes, edges } = idsFromResult(result, snapshotRef.current);
        if (nodes.length > 0 || edges.length > 0) {
          setOverlays((prev) => ({
            highlightNodes: union(prev.highlightNodes, nodes),
            highlightEdges: union(prev.highlightEdges, edges),
          }));
          if (nodes.length > 0) {
            setFilter({ label: `${op} results`, ids: new Set(nodes) });
            setSelectedOpId(null);
          }
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const applyFilter = useCallback((label: string, ids: string[]) => {
    setFilter({ label, ids: new Set(ids) });
    setOverlays((prev) => ({
      ...prev,
      highlightNodes: union(prev.highlightNodes, ids),
    }));
  }, []);

  const clearFilter = useCallback(() => {
    setFilter(null);
    setSelectedOpId(null);
  }, []);

  const onSelectOp = useCallback((opId: string | null) => {
    setSelectedOpId(opId);
    if (!opId) {
      setFilter(null);
      return;
    }
    setEvents((prevEvents) => {
      const ops = new Map<string, { op: string; steps: { phase: string; detail: Record<string, unknown> }[] }>();
      for (const event of prevEvents) {
        if (event.type === "op:start") ops.set(event.opId, { op: event.op, steps: [] });
        else if (event.type === "step") ops.get(event.opId)?.steps.push({ phase: event.phase, detail: event.detail });
      }
      const found = ops.get(opId);
      if (found) {
        const ids = opNodeIds(
          { opId, op: found.op, args: {}, steps: found.steps.map((s) => ({ ...s, at: 0 })), startedAt: 0 },
          snapshotRef.current
        );
        setFilter({ label: `op ${found.op} ${opId.slice(0, 8)}`, ids: new Set(ids) });
      }
      return prevEvents;
    });
  }, []);

  const hasHighlight = overlays.highlightNodes.length > 0 || overlays.highlightEdges.length > 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <StatsBar snapshot={snapshot} connected={connected} busy={busy} />

      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `${leftOpen ? "300px" : "40px"} minmax(0, 1fr) ${rightOpen ? "340px" : "40px"}`,
        }}
      >
        {/* left sidebar */}
        <aside className="flex min-h-0 flex-col border-r border-border bg-card/40">
          {leftOpen ? (
            <>
              <SidebarHead
                title="Explore"
                onCollapse={() => setLeftOpen(false)}
                collapseIcon={<PanelLeftClose className="h-3.5 w-3.5" />}
              />
              <ScrollArea className="flex-1 px-3 pb-3">
                <div className="space-y-4">
                  <OperationsTimeline
                    events={events}
                    snapshot={snapshot}
                    selectedOpId={selectedOpId}
                    onSelect={onSelectOp}
                  />
                  <Inspector
                    snapshot={snapshot}
                    prev={prevSnapshot}
                    selection={selection}
                    onSelect={setSelection}
                    onRun={onRun}
                    busy={busy}
                  />
                </div>
              </ScrollArea>
            </>
          ) : (
            <CollapsedRail onExpand={() => setLeftOpen(true)} label="Explore" />
          )}
        </aside>

        {/* center canvas */}
        <main className="relative flex min-h-0 min-w-0 flex-col bg-background">
          <div className="min-h-0 flex-1">
            <GraphView
              snapshot={snapshot}
              selection={selection}
              onSelect={setSelection}
              overlays={overlays}
              visibleIds={filter ? filter.ids : null}
            />
          </div>

          {/* bottom command bar: search + active filter/highlight */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
            <div className="pointer-events-auto flex max-w-[94vw] items-center gap-2 overflow-hidden rounded-full border border-border bg-background/95 py-1 pl-3 pr-1.5 shadow-lg backdrop-blur">
              <SemanticSearch onResults={applyFilter} busy={busy} />
              {filter && (
                <>
                  <span className="h-4 w-px shrink-0 bg-border" />
                  <Badge variant="secondary" className="max-w-64 shrink-0 truncate">
                    {filter.label} · {filter.ids.size}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={clearFilter} className="shrink-0 rounded-full">
                    <X className="h-3.5 w-3.5" />
                    all
                  </Button>
                </>
              )}
              {hasHighlight && (
                <>
                  <span className="h-4 w-px shrink-0 bg-border" />
                  <Button size="sm" variant="ghost" onClick={() => setOverlays(EMPTY_OVERLAYS)} className="shrink-0 rounded-full">
                    <Eraser className="h-3.5 w-3.5" />
                    highlight
                  </Button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2">
              <div className="flex max-w-[90vw] items-center gap-2 rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive shadow-lg">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-1 shrink-0 cursor-pointer rounded p-0.5 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </main>

        {/* right sidebar */}
        <aside className="flex min-h-0 flex-col border-l border-border bg-card/40">
          {rightOpen ? (
            <>
              <SidebarHead
                title="Control"
                onCollapse={() => setRightOpen(false)}
                collapseIcon={<PanelRightClose className="h-3.5 w-3.5" />}
              />
              <ScrollArea className="flex-1 px-3 pb-3">
                <div className="space-y-4">
                  <Controls selection={selection} onRun={onRun} busy={busy} error={null} />
                  <EventLog events={events} />
                </div>
              </ScrollArea>
            </>
          ) : (
            <CollapsedRail onExpand={() => setRightOpen(true)} label="Control" />
          )}
        </aside>
      </div>
    </div>
  );
}

function SidebarHead({
  title,
  onCollapse,
  collapseIcon,
}: {
  title: string;
  onCollapse: () => void;
  collapseIcon: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2.5">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        title="Collapse panel"
        onClick={onCollapse}
      >
        {collapseIcon}
      </Button>
    </div>
  );
}

function CollapsedRail({ onExpand, label }: { onExpand: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <Button variant="ghost" size="icon-sm" title={`Expand ${label}`} onClick={onExpand}>
        {label === "Explore" ? "›" : "‹"}
      </Button>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground [writing-mode:vertical-rl]">
        {label}
      </span>
    </div>
  );
}
