import type { ReactNode } from "react";
import type { StateSnapshot, WireEdge, WireNode } from "../types.ts";

export type Selection = { kind: "node" | "edge"; id: string } | null;

export function Inspector({
  snapshot,
  selection,
}: {
  snapshot: StateSnapshot | null;
  selection: Selection;
}) {
  if (!snapshot || !selection) {
    return (
      <div className="panel">
        <h2>Inspector</h2>
        <div className="body empty">Click a node or link in the graph.</div>
      </div>
    );
  }
  if (selection.kind === "node") {
    const node = snapshot.nodes.find((n) => n.id === selection.id);
    if (!node) return <Empty />;
    return (
      <div className="panel">
        <h2>Memory</h2>
        <div className="body">
          <KV k="id" v={<span className="mono">{node.id}</span>} />
          <KV k="type" v={node.type} />
          <KV k="status" v={<StatusChip status={node.status} />} />
          <KV k="description" v={node.description} />
          <KV k="importance" v={node.importance.toFixed(3)} />
          <KV k="validity" v={node.validity.toFixed(3)} />
          <KV k="rank" v={node.rank.toFixed(3)} />
          <KV k="last reinforce" v={date(node.lastReinforce)} />
          {node.invalidatedAt && <KV k="invalidated at" v={date(node.invalidatedAt)} />}
          {node.invalidateReason && <KV k="reason" v={node.invalidateReason} />}
          {node.supersededBy && (
            <KV k="superseded by" v={<span className="mono">{node.supersededBy}</span>} />
          )}
        </div>
      </div>
    );
  }
  const edge = snapshot.edges.find((e) => e.id === selection.id);
  if (!edge) return <Empty />;
  return (
    <div className="panel">
      <h2>Link</h2>
      <div className="body">
        <KV k="id" v={<span className="mono">{edge.id}</span>} />
        <KV k="type" v={<span style={{ color: `var(--${edge.type})` }}>{edge.type}</span>} />
        <KV k="status" v={<StatusChip status={edge.status} />} />
        <KV k="from" v={<span className="mono">{edge.from}</span>} />
        <KV k="to" v={<span className="mono">{edge.to}</span>} />
        <KV k="description" v={edge.description} />
        <KV k="strength" v={edge.strength.toFixed(3)} />
        <KV k="last reinforce" v={date(edge.lastReinforce)} />
        {edge.invalidateReason && <KV k="reason" v={edge.invalidateReason} />}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="panel">
      <h2>Inspector</h2>
      <div className="body empty">Not found.</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function StatusChip({ status }: { status: WireNode["status"] | WireEdge["status"] }) {
  return <span className={`chip ${status}`}>{status}</span>;
}

function date(iso: string): string {
  return new Date(iso).toLocaleString();
}
