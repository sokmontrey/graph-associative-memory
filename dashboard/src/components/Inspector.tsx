import type { ReactNode } from "react";
import { MousePointerClick } from "lucide-react";
import type { OpName, StateSnapshot, WireEdge, WireNode } from "../types.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";

export type Selection = { kind: "node" | "edge"; id: string } | null;

function delta(cur: number, prev: number | undefined): string {
  if (prev === undefined) return "";
  const d = cur - prev;
  if (Math.abs(d) < 0.0005) return "";
  return ` (${d > 0 ? "+" : ""}${d.toFixed(3)})`;
}

export function Inspector({
  snapshot,
  prev,
  selection,
  onSelect,
  onRun,
  busy,
}: {
  snapshot: StateSnapshot | null;
  /** Previous snapshot for decay deltas. */
  prev: StateSnapshot | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onRun: (op: OpName, args: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Inspector
        </span>
        {selection && (
          <Badge variant="outline" className="font-mono normal-case">
            {selection.id.slice(0, 8)}
          </Badge>
        )}
      </div>
      {!snapshot || !selection ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-6 text-center">
          <MousePointerClick className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Click a node or link in the graph to inspect it.</p>
        </div>
      ) : selection.kind === "node" ? (
        <NodeInspector
          snapshot={snapshot}
          prev={prev}
          nodeId={selection.id}
          onSelect={onSelect}
          onRun={onRun}
          busy={busy}
        />
      ) : (
        <EdgeInspector snapshot={snapshot} edgeId={selection.id} onSelect={onSelect} onRun={onRun} busy={busy} />
      )}
    </div>
  );
}

function NodeInspector({
  snapshot,
  prev,
  nodeId,
  onSelect,
  onRun,
  busy,
}: {
  snapshot: StateSnapshot;
  prev: StateSnapshot | null;
  nodeId: string;
  onSelect: (s: Selection) => void;
  onRun: (op: OpName, args: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const node = snapshot.nodes.find((n) => n.id === nodeId);
  if (!node)
    return <div className="rounded-lg border border-border px-3 py-4 text-xs text-muted-foreground">Not found.</div>;
  const prevNode = prev?.nodes.find((n) => n.id === nodeId);
  const incident = snapshot.edges.filter((e) => e.from === node.id || e.to === node.id);
  const contentById = new Map(snapshot.nodes.map((n) => [n.id, n.content]));

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <div className="space-y-2.5 p-3">
        <p className="text-[13px] leading-snug">{node.content}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{node.kind}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="importance" value={`${node.importance.toFixed(3)}${delta(node.importance, prevNode?.importance)}`} />
          <Metric label="links" value={String(incident.length)} />
        </div>
        <KV k="id" v={<span className="font-mono text-[11px]">{node.id}</span>} />
        <KV k="created" v={date(node.createdAt)} />
        <KV k="reinforced" v={date(node.lastReinforcedAt)} />
      </div>

      <Separator />

      <div className="space-y-1.5 p-3">
        <div className="text-[11px] font-medium text-muted-foreground">
          Edges ({incident.length})
        </div>
        {incident.length === 0 && <p className="text-xs text-muted-foreground">No links.</p>}
        <div className="max-h-44 space-y-1 overflow-y-auto nice-scroll">
          {incident.slice(0, 20).map((e) => {
            const peerId = e.from === node.id ? e.to : e.from;
            const dir = e.from === node.id ? "→" : "←";
            const peer = contentById.get(peerId) ?? "";
            return (
              <div key={e.id} className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  className="shrink-0 font-mono text-sky-500 hover:underline cursor-pointer"
                  title={e.description}
                  onClick={() => onSelect({ kind: "edge", id: e.id })}
                >
                  {e.relation}
                </button>
                <span className="text-muted-foreground">{dir}</span>
                <button
                  type="button"
                  className="truncate text-left hover:underline cursor-pointer"
                  title={peer}
                  onClick={() => onSelect({ kind: "node", id: peerId })}
                >
                  <span className="font-mono text-muted-foreground">{peerId.slice(0, 8)}</span>{" "}
                  <span className="text-foreground/90">“{peer.slice(0, 40)}”</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="flex flex-wrap gap-1.5 p-3">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun("reinforceNodes", { ids: [node.id] })}>
          Reinforce
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => onRun("forget", { ids: [node.id] })}
        >
          Forget
        </Button>
      </div>
    </div>
  );
}

function EdgeInspector({
  snapshot,
  edgeId,
  onSelect,
  onRun,
  busy,
}: {
  snapshot: StateSnapshot;
  edgeId: string;
  onSelect: (s: Selection) => void;
  onRun: (op: OpName, args: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const edge = snapshot.edges.find((e) => e.id === edgeId);
  if (!edge)
    return <div className="rounded-lg border border-border px-3 py-4 text-xs text-muted-foreground">Not found.</div>;
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-background/60 p-3">
      <Badge variant="info">{edge.relation}</Badge>
      <p className="text-[13px] leading-snug">{edge.description}</p>
      <div className="flex items-center gap-1.5 text-xs">
        <NodeLink id={edge.from} onSelect={onSelect} />
        <span className="text-muted-foreground">→</span>
        <NodeLink id={edge.to} onSelect={onSelect} />
      </div>
      <KV k="strength" v={edge.strength.toFixed(3)} />
      <KV k="id" v={<span className="font-mono text-[11px]">{edge.id}</span>} />
      <KV k="created" v={date(edge.createdAt)} />
      <KV k="reinforced" v={date(edge.lastReinforcedAt)} />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun("reinforceEdges", { ids: [edge.id] })}>
          Reinforce
        </Button>
      </div>
    </div>
  );
}

function NodeLink({ id, onSelect }: { id: string; onSelect: (s: Selection) => void }) {
  return (
    <button
      type="button"
      className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] hover:bg-secondary/70 cursor-pointer"
      onClick={() => onSelect({ kind: "node", id })}
    >
      {id.slice(0, 8)}
    </button>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-xs tabular-nums">{value}</div>
    </div>
  );
}

export function KindBadge({ kind }: { kind: WireNode["kind"] }) {
  return <Badge variant="outline">{kind}</Badge>;
}

export function RelationBadge({ relation }: { relation: WireEdge["relation"] }) {
  return <Badge variant="info">{relation}</Badge>;
}

function date(iso: string): string {
  return new Date(iso).toLocaleString();
}
