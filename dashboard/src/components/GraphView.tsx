import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Maximize, Minus, Plus, RotateCcw, Settings2 } from "lucide-react";
import type { StateSnapshot, WireEdge, WireNode } from "../types.ts";
import type { Selection } from "./Inspector.tsx";
import { Button } from "./ui/button.tsx";
import { Badge } from "./ui/badge.tsx";
import { cn } from "@/lib/utils";

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

// Free-form labels get stable colors from a small palette (hash of the label).
const NODE_PALETTE = [
  "var(--graph-preference)",
  "var(--graph-trait)",
  "var(--graph-observation)",
];
const EDGE_PALETTE = [
  "var(--graph-supports)",
  "var(--graph-contradicts)",
  "var(--graph-related)",
  "var(--graph-evokes)",
];

function hashLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function nodeColor(kind: string): string {
  return NODE_PALETTE[hashLabel(kind) % NODE_PALETTE.length]!;
}

function edgeColor(relation: string): string {
  return EDGE_PALETTE[hashLabel(relation) % EDGE_PALETTE.length]!;
}

export interface Overlays {
  highlightNodes: string[];
  highlightEdges: string[];
}

interface Physics {
  /** repulsion magnitudes (applied as negative charge) */
  isoCharge: number;
  conCharge: number;
  /** pull toward center */
  isoGravity: number;
  conGravity: number;
  /** extra collision padding around a node */
  isoGap: number;
  conGap: number;
  linkDistance: number;
}

const DEFAULT_PHYSICS: Physics = {
  isoCharge: 40,
  conCharge: 140,
  isoGravity: 0.18,
  conGravity: 0.02,
  isoGap: 8,
  conGap: 14,
  linkDistance: 64,
};

export function GraphView({
  snapshot,
  selection,
  onSelect,
  overlays,
  visibleIds,
}: {
  snapshot: StateSnapshot | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  overlays: Overlays;
  /** When set, only these node ids are rendered (filtered op/search view). */
  visibleIds: Set<string> | null;
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

  // Tunable layout physics (gear menu on the canvas).
  const [physics, setPhysics] = useState<Physics>(DEFAULT_PHYSICS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    const byId = nodesRef.current;
    const visibleNodes = visibleIds ? snapshot.nodes.filter((n) => visibleIds.has(n.id)) : snapshot.nodes;
    const visibleIdsSet = new Set(visibleNodes.map((n) => n.id));

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
    for (const id of [...byId.keys()]) if (!visibleIdsSet.has(id)) byId.delete(id);

    const simLinks: SimLink[] = snapshot.edges
      .filter((e) => visibleIdsSet.has(e.from) && visibleIdsSet.has(e.to))
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

    // Degree-aware forces: disconnected nodes (no incident links) get weak
    // repulsion, a strong pull toward the center, and a tight collision
    // radius — so they gather in a compact cluster instead of drifting apart.
    // Connected nodes keep wide spacing for readability.
    const degree = new Map<string, number>();
    for (const l of simLinks) {
      degree.set(l.edge.from, (degree.get(l.edge.from) ?? 0) + 1);
      degree.set(l.edge.to, (degree.get(l.edge.to) ?? 0) + 1);
    }
    const isolated = (d: SimNode) => (degree.get(d.id) ?? 0) === 0;
    const charge = () => forceManyBody<SimNode>().strength((d) => (isolated(d) ? -physics.isoCharge : -physics.conCharge));
    const collide = () => forceCollide<SimNode>((d) => d.r + (isolated(d) ? physics.isoGap : physics.conGap));
    const xPull = () => forceX<SimNode>(W / 2).strength((d) => (isolated(d) ? physics.isoGravity : physics.conGravity));
    const yPull = () => forceY<SimNode>(H / 2).strength((d) => (isolated(d) ? physics.isoGravity : physics.conGravity));
    const link = () =>
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(physics.linkDistance)
        .strength(0.55);

    if (!simRef.current) {
      simRef.current = forceSimulation<SimNode, SimLink>(simNodes)
        .force("charge", charge())
        .force("link", link())
        .force("center", forceCenter(W / 2, H / 2))
        .force("x", xPull())
        .force("y", yPull())
        .force("collide", collide())
        .on("tick", () => tick((x) => x + 1));
    } else {
      const sim = simRef.current;
      sim.nodes(simNodes);
      sim.force("charge", charge());
      sim.force("link", link());
      sim.force("center", forceCenter(W / 2, H / 2));
      sim.force("x", xPull());
      sim.force("y", yPull());
      sim.force("collide", collide());
      sim.alpha(0.6).restart();
    }
  }, [snapshot, visibleIds, physics]);

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
    sim.fx = undefined;
    sim.fy = undefined;
    simRef.current?.alphaTarget(0);
    if (!drag.moved) onSelect({ kind: "node", id: sim.id });
  };

  const highlightEdges = new Set(overlays.highlightEdges);
  const highlightNodes = new Set(overlays.highlightNodes);
  const nodes = [...nodesRef.current.values()];

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        className={cn("graph", panning && "panning")}
        viewBox={`0 0 ${W} ${H}`}
        onDoubleClick={(e) => {
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
          {linksRef.current.map((link) => {
            const [sx, sy, tx, ty] = endpoints(link);
            const active = highlightEdges.has(link.id);
            const selected = selection?.kind === "edge" && selection.id === link.id;
            return (
              <g key={link.id}>
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
                  <title>{`${link.edge.relation}: ${link.edge.description}`}</title>
                </line>
                <line
                  x1={sx}
                  y1={sy}
                  x2={tx}
                  y2={ty}
                  stroke={selected ? "#ffffff" : active ? "#ffd166" : edgeColor(link.edge.relation)}
                  strokeWidth={(selected ? 3 : active ? 3 : 0.75 + link.edge.strength * 1.5) / Math.sqrt(view.k)}
                  opacity={active ? 1 : 0.75}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {nodes.map((sim) => {
            const n = sim.node;
            const selected = selection?.kind === "node" && selection.id === n.id;
            const highlighted = highlightNodes.has(n.id);
            const color = nodeColor(n.kind);
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
                  fill={color}
                  fillOpacity={0.9}
                  stroke={selected ? "#ffffff" : highlighted ? "#ffd166" : color}
                  strokeWidth={(selected || highlighted ? 3 : 1) / Math.sqrt(view.k)}
                >
                  <title>{`${n.kind} · ${n.content}\nimportance ${n.importance.toFixed(2)}`}</title>
                </circle>
                <text
                  className="node-label"
                  x={sim.x}
                  y={(sim.y ?? 0) + sim.r + 9 / view.k}
                  textAnchor="middle"
                  fontSize={9 / Math.sqrt(view.k)}
                >
                  {truncate(n.content, 26)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* top-left count chip */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <Badge variant="secondary" className="bg-background/90 shadow-sm backdrop-blur">
          {nodes.length}
          {visibleIds ? ` of ${snapshot?.nodes.length ?? nodes.length}` : ""} shown
          {visibleIds ? " · filtered" : ""}
        </Badge>
      </div>

      {/* top-right zoom controls */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-11 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {Math.round(view.k * 100)}%
        </span>
        <Button variant="ghost" size="icon-sm" title="Zoom in" onClick={() => zoomBy(1.2)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Fit all nodes" onClick={fitView}>
          <Maximize className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Reset pan/zoom" onClick={resetView}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Layout physics"
          onClick={() => setSettingsOpen((v) => !v)}
          className={cn(settingsOpen && "bg-accent text-accent-foreground")}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* layout physics panel */}
      {settingsOpen && (
        <div className="absolute right-3 top-12 z-20 w-72 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Layout physics
            </span>
            <button
              type="button"
              onClick={() => setPhysics(DEFAULT_PHYSICS)}
              className="ml-auto cursor-pointer text-[11px] text-sky-500 hover:underline"
            >
              reset
            </button>
          </div>
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Loners (no links)</div>
              <div className="space-y-1.5">
                <PhysSlider label="Cluster pull" value={physics.isoGravity} min={0} max={1} step={0.01}
                  onChange={(v) => setPhysics((p) => ({ ...p, isoGravity: v }))} />
                <PhysSlider label="Repulsion" value={physics.isoCharge} min={0} max={300} step={1}
                  onChange={(v) => setPhysics((p) => ({ ...p, isoCharge: v }))} />
                <PhysSlider label="Min gap" value={physics.isoGap} min={0} max={40} step={1}
                  onChange={(v) => setPhysics((p) => ({ ...p, isoGap: v }))} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Linked nodes</div>
              <div className="space-y-1.5">
                <PhysSlider label="Repulsion" value={physics.conCharge} min={0} max={400} step={1}
                  onChange={(v) => setPhysics((p) => ({ ...p, conCharge: v }))} />
                <PhysSlider label="Min gap" value={physics.conGap} min={0} max={40} step={1}
                  onChange={(v) => setPhysics((p) => ({ ...p, conGap: v }))} />
                <PhysSlider label="Link length" value={physics.linkDistance} min={20} max={200} step={1}
                  onChange={(v) => setPhysics((p) => ({ ...p, linkDistance: v }))} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* bottom-left legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 hidden items-center gap-1.5 rounded-lg border border-border bg-background/90 px-2.5 py-1.5 shadow-sm backdrop-blur sm:flex">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="inline-block h-0.5 w-4 rounded bg-amber-300" /> op highlight
        </span>
      </div>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-xs rounded-xl border border-dashed border-border bg-background/80 px-6 py-8 text-center backdrop-blur">
            <div className="text-sm font-medium">No memories to show</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Remember something from the control panel, or clear the current filter.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function radius(node: WireNode): number {
  return 7 + node.importance * 16;
}

function endpoints(link: SimLink): [number, number, number, number] {
  const s = typeof link.source === "object" ? link.source : undefined;
  const t = typeof link.target === "object" ? link.target : undefined;
  return [s?.x ?? 0, s?.y ?? 0, t?.x ?? 0, t?.y ?? 0];
}

function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function PhysSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid grid-cols-[72px_1fr_56px] items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary"
      />
      <input
        type="number"
        min={0}
        step={step}
        value={step < 1 ? Number(value.toFixed(2)) : value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(v);
        }}
        title="Type an exact value (can exceed the slider range)"
        className="h-6 w-full rounded border border-input bg-background px-1 text-right font-mono tabular-nums text-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}
