import { useCallback, useEffect, useRef, useState } from "react";
import { fetchState, runOp, subscribe, tick } from "./api.ts";
import type { MemoryEvent, OpName, StateSnapshot } from "./types.ts";
import { StatsBar } from "./components/StatsBar.tsx";
import { GraphView, pairKey, type Overlays } from "./components/GraphView.tsx";
import { OperationsTimeline } from "./components/OperationsTimeline.tsx";
import { Inspector, type Selection } from "./components/Inspector.tsx";
import { Controls } from "./components/Controls.tsx";
import { EventLog } from "./components/EventLog.tsx";

const EMPTY_OVERLAYS: Overlays = {
  recallEdges: [],
  recallNodes: [],
  proposalPairs: [],
  favored: null,
};

function reduceOverlays(prev: Overlays, event: MemoryEvent): Overlays {
  if (event.type === "op:start" && event.op === "recall") return { ...EMPTY_OVERLAYS };
  if (event.type === "op:start" && event.op === "proposeLinks")
    return { ...prev, proposalPairs: [], favored: null };
  if (event.type !== "step") return prev;

  const phase = event.phase;
  const detail = event.detail;
  if (phase === "anchors" || phase === "goals") {
    const ids = (detail["ids"] as string[] | undefined) ?? [];
    return { ...prev, recallNodes: union(prev.recallNodes, ids) };
  }
  if (phase === "hop") {
    return {
      ...prev,
      recallEdges: union(prev.recallEdges, [String(detail["edgeId"])]),
      recallNodes: union(prev.recallNodes, [String(detail["fromId"]), String(detail["toId"])]),
    };
  }
  if (phase === "ground") {
    const pair = pairKey(String(detail["fromId"]), String(detail["toId"]));
    return {
      ...prev,
      proposalPairs: union(prev.proposalPairs, [pair]),
      favored: detail["favoredId"] ? String(detail["favoredId"]) : prev.favored,
    };
  }
  return prev;
}

function union(list: string[], extra: string[]): string[] {
  const set = new Set(list);
  for (const item of extra) set.add(item);
  return [...set];
}

export function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [showInvalidated, setShowInvalidated] = useState(true);
  const [overlays, setOverlays] = useState<Overlays>(EMPTY_OVERLAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetchTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await fetchState());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const close = subscribe(
      (event) => {
        setEvents((prev) => [...prev.slice(-599), event]);
        setOverlays((prev) => reduceOverlays(prev, event));
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
        // Highlight the recall path from the POST result directly, so it does
        // not depend solely on SSE step timing. SSE hops still union in.
        if (op === "recall" && result && typeof result === "object") {
          const r = result as {
            anchors?: { id: string }[];
            goals?: { id: string }[];
            path?: { fromId: string; edge: { id: string }; to: { id: string } }[];
          };
          const recallEdges = (r.path ?? []).map((s) => s.edge.id);
          const recallNodes = [
            ...(r.anchors ?? []).map((n) => n.id),
            ...(r.goals ?? []).map((n) => n.id),
            ...(r.path ?? []).flatMap((s) => [s.fromId, s.to.id]),
          ];
          setOverlays((prev) => ({
            ...prev,
            recallEdges: [...new Set([...prev.recallEdges, ...recallEdges])],
            recallNodes: [...new Set([...prev.recallNodes, ...recallNodes])],
          }));
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

  const onTick = useCallback(async () => {
    setBusy(true);
    try {
      await tick();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="app">
      <StatsBar snapshot={snapshot} connected={connected} />
      <div className="app-body">
        <div className="col">
          <GraphView
            snapshot={snapshot}
            selection={selection}
            onSelect={setSelection}
            overlays={overlays}
            showInvalidated={showInvalidated}
          />
          <div className="row">
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={showInvalidated}
                onChange={(e) => setShowInvalidated(e.target.checked)}
              />
              show invalidated
            </label>
            <span className="muted">realtime overlays: recall path, proposals, favored winner</span>
            {(overlays.recallEdges.length > 0 || overlays.recallNodes.length > 0) && (
              <span className="muted">
                recall: {overlays.recallNodes.length} nodes / {overlays.recallEdges.length} edges
              </span>
            )}
            <button type="button" onClick={() => setOverlays(EMPTY_OVERLAYS)}>
              clear highlight
            </button>
          </div>
          <Controls
            selection={selection}
            onRun={onRun}
            onTick={onTick}
            busy={busy}
            error={error}
          />
        </div>
        <div className="col right">
          <OperationsTimeline events={events} snapshot={snapshot} />
          <Inspector snapshot={snapshot} selection={selection} />
          <EventLog events={events} />
        </div>
      </div>
    </div>
  );
}
