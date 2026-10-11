import { useState, type ReactNode } from "react";
import type { EdgeType, NodeType, OpName } from "../types.ts";
import type { Selection } from "./Inspector.tsx";

const NODE_TYPES: NodeType[] = ["preference", "trait", "observation"];
const EDGE_TYPES: EdgeType[] = ["supports", "contradicts", "related_to", "evokes"];

export function Controls({
  selection,
  onRun,
  onTick,
  busy,
  error,
}: {
  selection: Selection;
  onRun: (op: OpName, args: Record<string, unknown>) => void;
  onTick: () => void;
  busy: boolean;
  error: string | null;
}) {
  const selectedNodeId = selection?.kind === "node" ? selection.id : "";
  const selectedEdgeId = selection?.kind === "edge" ? selection.id : "";

  const [topType, setTopType] = useState("all");
  const [topN, setTopN] = useState(10);
  const [topQ, setTopQ] = useState("");
  const [initial, setInitial] = useState("1962 deed tin box lamp stair");
  const [goal, setGoal] = useState("lighthouse Cormorant Point");
  const [hints, setHints] = useState("");
  const [remType, setRemType] = useState<NodeType>("observation");
  const [desc, setDesc] = useState("");
  const [linkOther, setLinkOther] = useState("");
  const [linkDir, setLinkDir] = useState<"out" | "in">("out");
  const [linkEdge, setLinkEdge] = useState<EdgeType>("related_to");
  const [linkDesc, setLinkDesc] = useState("");
  const [focus, setFocus] = useState("");
  const [memId, setMemId] = useState("");
  const [reason, setReason] = useState("");
  const [keepId, setKeepId] = useState("");
  const [dropId, setDropId] = useState("");
  const [rationale, setRationale] = useState("");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");
  const [edgeId, setEdgeId] = useState("");

  const nodeArg = (value: string) => value || selectedNodeId;
  const edgeArg = (value: string) => value || selectedEdgeId;

  return (
    <div className="panel">
      <h2>Controls</h2>
      <div className="body">
        {error && <div style={{ color: "var(--contradicts)", marginBottom: 8 }}>{error}</div>}

        <Section title="getTopImportance">
          <div className="row">
            <select value={topType} onChange={(e) => setTopType(e.target.value)}>
              <option value="all">all</option>
              {NODE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input type="number" min={1} max={100} value={topN} onChange={(e) => setTopN(Number(e.target.value))} style={{ width: 70 }} />
            <input placeholder="semantic query (optional)" value={topQ} onChange={(e) => setTopQ(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" disabled={busy} onClick={() => onRun("getTopImportance", { type: topType, n: topN, semanticQuery: topQ || undefined })}>
              Run
            </button>
          </div>
        </Section>

        <Section title="recall">
          <div className="muted" style={{ marginBottom: 4, fontSize: 11 }}>
            Walks out-edges new → old. Path highlights yellow; empty path means no directed route.
          </div>
          <div className="row">
            <input placeholder="initial idea" value={initial} onChange={(e) => setInitial(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="goal idea" value={goal} onChange={(e) => setGoal(e.target.value)} style={{ flex: 1 }} />
          </div>
          <div className="row">
            <input placeholder="hints (comma separated)" value={hints} onChange={(e) => setHints(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" disabled={busy || !initial || !goal} onClick={() => onRun("recall", { initialIdea: initial, goalIdea: goal, searchHints: hints ? hints.split(",").map((h) => h.trim()).filter(Boolean) : undefined })}>
              Recall
            </button>
          </div>
        </Section>

        <Section title="remember">
          <div className="row">
            <select value={remType} onChange={(e) => setRemType(e.target.value as NodeType)}>
              {NODE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input placeholder="description" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 1 }} />
          </div>
          <div className="row">
            <input placeholder="link to id (optional)" value={linkOther} onChange={(e) => setLinkOther(e.target.value)} style={{ flex: 1 }} />
            <select value={linkDir} onChange={(e) => setLinkDir(e.target.value as "out" | "in")}>
              <option value="out">out</option>
              <option value="in">in</option>
            </select>
            <select value={linkEdge} onChange={(e) => setLinkEdge(e.target.value as EdgeType)}>
              {EDGE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input placeholder="link reason" value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} style={{ flex: 1 }} />
            <button
              className="primary"
              disabled={busy || !desc}
              onClick={() =>
                onRun("remember", {
                  type: remType,
                  description: desc,
                  links: linkOther ? [{ otherNodeId: linkOther, direction: linkDir, edgeType: linkEdge, description: linkDesc || linkEdge }] : [],
                })
              }
            >
              Remember
            </button>
          </div>
        </Section>

        <Section title="proposeLinks / connect">
          <div className="row">
            <input placeholder={`focus id (selected: ${selectedNodeId.slice(0, 8) || "—"})`} value={focus} onChange={(e) => setFocus(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" disabled={busy} onClick={() => onRun("proposeLinks", { focusId: focus || selectedNodeId || undefined, limit: 20 })}>
              Propose
            </button>
          </div>
          <div className="row">
            <input placeholder={`from id (selected: ${selectedNodeId.slice(0, 8) || "—"})`} value={cFrom} onChange={(e) => setCFrom(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="to id" value={cTo} onChange={(e) => setCTo(e.target.value)} style={{ flex: 1 }} />
            <select value={linkEdge} onChange={(e) => setLinkEdge(e.target.value as EdgeType)}>
              {EDGE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button className="primary" disabled={busy || !nodeArg(cFrom) || !cTo} onClick={() => onRun("connect", { fromId: nodeArg(cFrom), toId: cTo, edgeType: linkEdge, description: linkDesc || linkEdge })}>
              Connect
            </button>
          </div>
        </Section>

        <Section title="belief maintenance">
          <div className="row">
            <input placeholder={`memory id (selected: ${selectedNodeId.slice(0, 8) || "—"})`} value={memId} onChange={(e) => setMemId(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
            <button disabled={busy} onClick={() => onRun("reinforce", { memoryId: nodeArg(memId) })}>
              Reinforce
            </button>
            <button disabled={busy} onClick={() => onRun("challenge", { memoryId: nodeArg(memId), reason: reason || "challenged" })}>
              Challenge
            </button>
            <button className="accent" disabled={busy} onClick={() => onRun("corroborate", { memoryId: nodeArg(memId), reason: reason || undefined })}>
              Corroborate
            </button>
            <button className="danger" disabled={busy} onClick={() => onRun("invalidate", { target: { nodeId: nodeArg(memId) }, reason: reason || "invalidated" })}>
              Invalidate node
            </button>
            <button disabled={busy} onClick={() => onRun("reinstate", { target: { nodeId: nodeArg(memId) }, reason: reason || undefined })}>
              Reinstate
            </button>
          </div>
          <div className="row">
            <input placeholder={`edge id (selected: ${selectedEdgeId.slice(0, 8) || "—"})`} value={edgeId} onChange={(e) => setEdgeId(e.target.value)} style={{ flex: 1 }} />
            <button className="danger" disabled={busy} onClick={() => onRun("invalidate", { target: { edgeId: edgeArg(edgeId) }, reason: reason || "invalidated" })}>
              Invalidate link
            </button>
            <button disabled={busy} onClick={() => onRun("reinstate", { target: { edgeId: edgeArg(edgeId) } })}>
              Reinstate link
            </button>
          </div>
        </Section>

        <Section title="resolveContradiction">
          <div className="row">
            <input placeholder={`keep id (selected: ${selectedNodeId.slice(0, 8) || "—"})`} value={keepId} onChange={(e) => setKeepId(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="drop id" value={dropId} onChange={(e) => setDropId(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} style={{ flex: 1 }} />
            <button className="danger" disabled={busy || !nodeArg(keepId) || !dropId} onClick={() => onRun("resolveContradiction", { keepId: nodeArg(keepId), dropId, rationale: rationale || "resolved" })}>
              Resolve
            </button>
          </div>
        </Section>

        <Section title="decay">
          <button disabled={busy} onClick={onTick}>
            tick() — decay all active
          </button>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="muted" style={{ marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
