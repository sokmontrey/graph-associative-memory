import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { EdgeType, NodeType, StateSnapshot, WireEdge, WireNode } from "../types.ts";
import type { Selection } from "./Inspector.tsx";

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: WireNode;
  r: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { id: string; edge: WireEdge };

interface View {
  x: number;
  y: number;
  k: number;
}

const W = 900;
const H = 620;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const NODE_COLOR: Record<NodeType, string> = {
  preference: "var(--preference)",
  trait: "var(--trait)",
  observation: "var(--observation)",
};

export interface Overlays {
  recallEdges: string[];
  recallNodes: string[];
  proposalPairs: string[];
  favored: string | null;
}

export function GraphView({
  snapshot,
  selection,
  onSelect,
  overlays,
  showInvalidated,
}: {
  snapshot: StateSnapshot | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  overlays: Overlays;
  showInvalidated: boolean;
}) {
  const nodesRef = useRef(new Map<string, SimNode>());
  const linksRef = useRef<SimLink[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [, tick] = useState(0);

  // Pan/zoom view transform (in viewBox units): translate + uniform scale.
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{ id: string; moved: boolean; lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const byId = nodesRef.current;
    const visibleNodes = snapshot.nodes.filter((n) => showInvalidated || n.status === "active");
    const visibleIds = new Set(visibleNodes.map((n) => n.id));

    const simNodes = visibleNodes.map((n) => {
      const existing = byId.get(n.id);
      if (existing) {
        existing.node = n;
        existing.r = radius(n);
        return existing;
      }
      const created: SimNode = {
        id: n.id,
        node: n,
        r: radius(n),
        x: W / 2 + (Math.random() - 0.5) * 200,
        y: H / 2 + (Math.random() - 0.5) * 200,
      };
      byId.set(n.id, created);
      return created;
    });
    for (const id of [...byId.keys()]) if (!visibleIds.has(id)) byId.delete(id);

    const simLinks: SimLink[] = snapshot.edges
      .filter(
        (e) =>
          (showInvalidated || e.status === "active") &&
          visibleIds.has(e.from) &&
          visibleIds.has(e.to)
      )
      .map((e) => {
        const prev = linksRef.current.find((l) => l.id === e.id);
        if (prev && prev.edge.from === e.from && prev.edge.to === e.to) {
          prev.edge = e;
          return prev;
        }
        const from = byId.get(e.from);
        const to = byId.get(e.to);
        return {
          id: e.id,
          source: (from ?? e.from) as SimNode | string,
          target: (to ?? e.to) as SimNode | string,
          edge: e,
        };
      });
    linksRef.current = simLinks;

    if (!simRef.current) {
      simRef.current = forceSimulation<SimNode, SimLink>(simNodes)
        .force("charge", forceManyBody<SimNode>().strength(-220))
        .force(
          "link",
          forceLink<SimNode, SimLink>(simLinks)
            .id((d) => d.id)
            .distance(80)
            .strength(0.35)
        )
        .force("center", forceCenter(W / 2, H / 2))
        .force("collide", forceCollide<SimNode>((d) => d.r + 8))
        .on("tick", () => tick((x) => x + 1));
    } else {
      const sim = simRef.current;
      sim.nodes(simNodes);
      sim.force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(80).strength(0.35));
      sim.alpha(0.6).restart();
    }
  }, [snapshot, showInvalidated]);

  useEffect(() => () => void simRef.current?.stop(), []);

  // Wheel-to-zoom with anchored cursor. Native non-passive listener so we can
  // preventDefault and keep the page from scrolling while zooming the graph.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      const scale = k / v.k;
      setView({
        k,
        x: px - (px - v.x) * scale,
        y: py - (py - v.y) * scale,
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const v = viewRef.current;
    const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
    const scale = k / v.k;
    const cx = W / 2;
    const cy = H / 2;
    setView({ k, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale });
  }, []);

  const resetView = useCallback(() => setView({ x: 0, y: 0, k: 1 }), []);

  const fitView = useCallback(() => {
    const nodes = [...nodesRef.current.values()];
    if (nodes.length === 0) {
      setView({ x: 0, y: 0, k: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? W / 2;
      const y = n.y ?? H / 2;
      const r = n.r + 24;
      minX = Math.min(minX, x - r);
      minY = Math.min(minY, y - r);
      maxX = Math.max(maxX, x + r);
      maxY = Math.max(maxY, y + r);
    }
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const k = clamp(Math.min(W / bw, H / bh, 2), MIN_ZOOM, MAX_ZOOM);
    setView({
      k,
      x: (W - (minX + maxX) * k) / 2,
      y: (H - (minY + maxY) * k) / 2,
    });
  }, []);

  // Background pan (pointer events unify mouse + touch).
  const onBackgroundPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (dragRef.current) return;
    // Only pan with primary button / touch contact.
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    panRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onBackgroundPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - pan.startClientX) / rect.width) * W;
    const dy = ((e.clientY - pan.startClientY) / rect.height) * H;
    if (Math.abs(e.clientX - pan.startClientX) + Math.abs(e.clientY - pan.startClientY) > 4) {
      pan.moved = true;
    }
    setView({ ...viewRef.current, x: pan.originX + dx, y: pan.originY + dy });
  };
  const endBackgroundPan = (e: React.PointerEvent<SVGRectElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    panRef.current = null;
    setPanning(false);
    // Plain click (no drag) on empty canvas clears the selection.
    if (!pan.moved) onSelect(null);
  };

  const onNodePointerDown = (e: React.PointerEvent<SVGGElement>, sim: SimNode) => {
    e.stopPropagation();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { id: sim.id, moved: false, lastX: e.clientX, lastY: e.clientY };
    sim.fx = sim.x;
    sim.fy = sim.y;
    simRef.current?.alphaTarget(0.3).restart();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onNodePointerMove = (e: React.PointerEvent<SVGGElement>, sim: SimNode) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== sim.id) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convert screen-pixel movement into sim coords (undo viewBox scale + zoom).
    // Uses client deltas (not movementX) so touch/pen dragging works too.
    const dx = ((e.clientX - drag.lastX) / rect.width) * W / viewRef.current.k;
    const dy = ((e.clientY - drag.lastY) / rect.height) * H / viewRef.current.k;
    if (Math.abs(e.clientX - drag.lastX) + Math.abs(e.clientY - drag.lastY) > 0) drag.moved = true;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    sim.x = (sim.x ?? 0) + dx;
    sim.y = (sim.y ?? 0) + dy;
    sim.fx = sim.x;
    sim.fy = sim.y;
  };
  const onNodePointerUp = (e: React.PointerEvent<SVGGElement>, sim: SimNode) => {
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.id !== sim.id) return;
    dragRef.current = null;
    // Release the pin so the force layout can settle around the new position.
    sim.fx = undefined;
    sim.fy = undefined;
    simRef.current?.alphaTarget(0);
    if (!drag.moved) onSelect({ kind: "node", id: sim.id });
  };

  const recallEdges = new Set(overlays.recallEdges);
  const recallNodes = new Set(overlays.recallNodes);
  const proposalPairs = new Set(overlays.proposalPairs);
  const nodes = [...nodesRef.current.values()];

  return (
    <div className="panel">
      <div className="graph-head">
        <h2>Graph ({nodes.length} shown)</h2>
        <div className="graph-controls">
          <button type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
          <span className="mono muted" style={{ minWidth: 44, textAlign: "center" }}>
            {Math.round(view.k * 100)}%
          </span>
          <button type="button" title="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
          <button type="button" title="Fit all nodes" onClick={fitView}>fit</button>
          <button type="button" title="Reset pan/zoom" onClick={resetView}>reset</button>
        </div>
      </div>
      <div className="body">
        <div className="graph-wrap">
          <svg
            ref={svgRef}
            className={`graph${panning ? " panning" : ""}`}
            viewBox={`0 0 ${W} ${H}`}
            onDoubleClick={(e) => {
              // Double-click empty canvas zooms in at the cursor; shift+double-click zooms out.
              if ((e.target as Element).closest("g[data-node]")) return;
              zoomBy(e.shiftKey ? 1 / 1.4 : 1.4);
            }}
          >
            <rect
              className="graph-bg"
              x={-4000}
              y={-4000}
              width={W + 8000}
              height={H + 8000}
              fill="transparent"
              onPointerDown={onBackgroundPointerDown}
              onPointerMove={onBackgroundPointerMove}
              onPointerUp={endBackgroundPan}
              onPointerCancel={endBackgroundPan}
            />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {proposalPairs.size > 0 &&
                nodes.map((a) =>
                  nodes
                    .filter((b) => b.id !== a.id && proposalPairs.has(pairKey(a.id, b.id)))
                    .map((b) => (
                      <line
                        key={`p-${a.id}-${b.id}`}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#7cc4ff"
                        strokeWidth={1.5 / view.k}
                        strokeDasharray="5 4"
                        opacity={0.8}
                        pointerEvents="none"
                      />
                    ))
                )}
              {linksRef.current.map((link) => {
                const [sx, sy, tx, ty] = endpoints(link);
                const active = recallEdges.has(link.id);
                const invalid = link.edge.status === "invalidated";
                const selected = selection?.kind === "edge" && selection.id === link.id;
                return (
                  <g key={link.id}>
                    {/* Wide invisible hit-area so thin links are easy to click. */}
                    <line
                      x1={sx}
                      y1={sy}
                      x2={tx}
                      y2={ty}
                      stroke="transparent"
                      strokeWidth={Math.max(10 / view.k, 6)}
                      onClick={() => onSelect({ kind: "edge", id: link.id })}
                      style={{ cursor: "pointer" }}
                    >
                      <title>{`${link.edge.type}: ${link.edge.description}`}</title>
                    </line>
                    <line
                      x1={sx}
                      y1={sy}
                      x2={tx}
                      y2={ty}
                      stroke={selected ? "#ffffff" : active ? "#ffd166" : `var(--${link.edge.type})`}
                      strokeWidth={(selected ? 3 : active ? 3 : 0.75 + link.edge.strength * 1.5) / Math.sqrt(view.k)}
                      strokeDasharray={invalid ? "4 4" : undefined}
                      opacity={invalid ? 0.35 : active ? 1 : 0.75}
                      pointerEvents="none"
                    />
                  </g>
                );
              })}
              {nodes.map((sim) => {
                const n = sim.node;
                const invalid = n.status === "invalidated";
                const selected = selection?.kind === "node" && selection.id === n.id;
                const recall = recallNodes.has(n.id);
                const favored = overlays.favored === n.id;
                return (
                  <g
                    key={n.id}
                    data-node={n.id}
                    onPointerDown={(e) => onNodePointerDown(e, sim)}
                    onPointerMove={(e) => onNodePointerMove(e, sim)}
                    onPointerUp={(e) => onNodePointerUp(e, sim)}
                    onPointerCancel={(e) => onNodePointerUp(e, sim)}
                    style={{ cursor: "grab", touchAction: "none" }}
                  >
                    <circle
                      cx={sim.x}
                      cy={sim.y}
                      r={sim.r}
                      fill={invalid ? "var(--invalid)" : NODE_COLOR[n.type]}
                      fillOpacity={invalid ? 0.4 : 0.35 + n.validity * 0.65}
                      stroke={selected ? "#ffffff" : favored ? "#ffd166" : invalid ? "var(--invalid)" : NODE_COLOR[n.type]}
                      strokeWidth={(selected || favored ? 3 : recall ? 2.5 : 1) / Math.sqrt(view.k)}
                      strokeDasharray={invalid ? "3 3" : undefined}
                    >
                      <title>{`${n.type} · ${n.description}\nimportance ${n.importance.toFixed(2)} · validity ${n.validity.toFixed(2)} · ${n.status}`}</title>
                    </circle>
                    <text
                      className="node-label"
                      x={sim.x}
                      y={(sim.y ?? 0) + sim.r + 9 / view.k}
                      textAnchor="middle"
                      fontSize={9 / Math.sqrt(view.k)}
                    >
                      {truncate(n.description, 26)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        <div className="row muted graph-hint" style={{ marginTop: 6 }}>
          <span className="chip">recall path</span>
          <span className="chip">proposal</span>
          <span className="chip">favored winner</span>
          <span>scroll to zoom · drag canvas to pan · drag node to move · double-click to zoom · click empty space to deselect</span>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function radius(node: WireNode): number {
  return 7 + node.importance * 16;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function endpoints(link: SimLink): [number, number, number, number] {
  const s = typeof link.source === "object" ? link.source : undefined;
  const t = typeof link.target === "object" ? link.target : undefined;
  return [s?.x ?? 0, s?.y ?? 0, t?.x ?? 0, t?.y ?? 0];
}

function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

export { pairKey };
export type { EdgeType };
