import { useState } from "react";
import { AlertTriangle, Hourglass } from "lucide-react";
import type { EdgeType, NodeType, OpName } from "../types.ts";
import type { Selection } from "./Inspector.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Select } from "./ui/select.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { CollapsibleSection } from "./ui/collapsible-section.tsx";
import { Badge } from "./ui/badge.tsx";

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
  const [initial, setInitial] = useState("");
  const [goal, setGoal] = useState("");
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Control
        </span>
        {(selectedNodeId || selectedEdgeId) && (
          <Badge variant="outline" className="font-mono normal-case">
            {(selectedNodeId || selectedEdgeId).slice(0, 8)} selected
          </Badge>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <CollapsibleSection title="Recall" description="Walk out-edges from initial to goal" defaultOpen>
        <div className="grid gap-1.5">
          <div className="grid gap-1">
            <Label>Initial idea</Label>
            <Input placeholder="e.g. mechanical keyboard" value={initial} onChange={(e) => setInitial(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Goal idea</Label>
            <Input placeholder="e.g. late-night work" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Hints (comma separated)</Label>
            <Input placeholder="optional" value={hints} onChange={(e) => setHints(e.target.value)} />
          </div>
          <Button
            disabled={busy || !initial || !goal}
            onClick={() =>
              onRun("recall", {
                initialIdea: initial,
                goalIdea: goal,
                searchHints: hints ? hints.split(",").map((h) => h.trim()).filter(Boolean) : undefined,
              })
            }
          >
            Recall
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Path highlights amber; empty path means no directed route.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Remember" description="Store a new memory">
        <div className="grid gap-1.5">
          <div className="flex gap-1.5">
            <Select value={remType} onChange={(e) => setRemType(e.target.value as NodeType)} className="w-32">
              {NODE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <Input placeholder="description" value={desc} onChange={(e) => setDesc(e.target.value)} className="flex-1" />
          </div>
          <div className="flex gap-1.5">
            <Input placeholder="link to id (optional)" value={linkOther} onChange={(e) => setLinkOther(e.target.value)} className="flex-1" />
            <Select value={linkDir} onChange={(e) => setLinkDir(e.target.value as "out" | "in")} className="w-20">
              <option value="out">out</option>
              <option value="in">in</option>
            </Select>
          </div>
          <div className="flex gap-1.5">
            <Select value={linkEdge} onChange={(e) => setLinkEdge(e.target.value as EdgeType)} className="flex-1">
              {EDGE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <Input placeholder="link reason" value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} className="flex-1" />
          </div>
          <Button
            disabled={busy || !desc}
            onClick={() =>
              onRun("remember", {
                type: remType,
                description: desc,
                links: linkOther
                  ? [{ otherNodeId: linkOther, direction: linkDir, edgeType: linkEdge, description: linkDesc || linkEdge }]
                  : [],
              })
            }
          >
            Remember
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Rank / search" description="Top importance, optionally semantic">
        <div className="flex gap-1.5">
          <Select value={topType} onChange={(e) => setTopType(e.target.value)} className="w-28">
            <option value="all">all</option>
            {NODE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            max={100}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="w-16"
          />
          <Button
            disabled={busy}
            onClick={() => onRun("getTopImportance", { type: topType, n: topN, semanticQuery: topQ || undefined })}
          >
            Run
          </Button>
        </div>
        <Input
          placeholder="semantic query (optional)"
          value={topQ}
          onChange={(e) => setTopQ(e.target.value)}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Propose / connect" description="Grounded link proposals">
        <div className="flex gap-1.5">
          <Input
            placeholder={selectedNodeId ? `focus ${selectedNodeId.slice(0, 8)}` : "focus id (or selected)"}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className="flex-1"
          />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onRun("proposeLinks", { focusId: focus || selectedNodeId || undefined, limit: 20 })}
          >
            Propose
          </Button>
        </div>
        <div className="grid gap-1.5">
          <div className="flex gap-1.5">
            <Input placeholder="from id" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="flex-1" />
            <Input placeholder="to id" value={cTo} onChange={(e) => setCTo(e.target.value)} className="flex-1" />
          </div>
          <div className="flex gap-1.5">
            <Select value={linkEdge} onChange={(e) => setLinkEdge(e.target.value as EdgeType)} className="flex-1">
              {EDGE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={busy || !nodeArg(cFrom) || !cTo}
              onClick={() => onRun("connect", { fromId: nodeArg(cFrom), toId: cTo, edgeType: linkEdge, description: linkDesc || linkEdge })}
            >
              Connect
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Belief" description="Reinforce · challenge · corroborate">
        <Input
          placeholder={selectedNodeId ? `memory ${selectedNodeId.slice(0, 8)}` : "memory id (or selected)"}
          value={memId}
          onChange={(e) => setMemId(e.target.value)}
        />
        <Input placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun("reinforce", { memoryId: nodeArg(memId) })}>
            Reinforce
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun("challenge", { memoryId: nodeArg(memId), reason: reason || "challenged" })}>
            Challenge
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun("corroborate", { memoryId: nodeArg(memId), reason: reason || undefined })}>
            Corroborate
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => onRun("invalidate", { target: { nodeId: nodeArg(memId) }, reason: reason || "invalidated" })}
          >
            Invalidate node
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun("reinstate", { target: { nodeId: nodeArg(memId) }, reason: reason || undefined })}>
            Reinstate
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Input
            placeholder={selectedEdgeId ? `edge ${selectedEdgeId.slice(0, 8)}` : "edge id"}
            value={edgeId}
            onChange={(e) => setEdgeId(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => onRun("invalidate", { target: { edgeId: edgeArg(edgeId) }, reason: reason || "invalidated" })}
          >
            Unlink
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun("reinstate", { target: { edgeId: edgeArg(edgeId) } })}>
            Relink
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Resolve contradiction" description="Keep one, retire the other">
        <div className="flex gap-1.5">
          <Input placeholder="keep id" value={keepId} onChange={(e) => setKeepId(e.target.value)} className="flex-1" />
          <Input placeholder="drop id" value={dropId} onChange={(e) => setDropId(e.target.value)} className="flex-1" />
        </div>
        <Textarea placeholder="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} />
        <Button
          variant="destructive"
          disabled={busy || !nodeArg(keepId) || !dropId}
          onClick={() => onRun("resolveContradiction", { keepId: nodeArg(keepId), dropId, rationale: rationale || "resolved" })}
        >
          Resolve
        </Button>
      </CollapsibleSection>

      <CollapsibleSection title="Decay" description="Uniform salience erosion">
        <Button variant="outline" disabled={busy} onClick={onTick} className="w-full">
          <Hourglass className="h-3.5 w-3.5" />
          tick() — decay all active
        </Button>
      </CollapsibleSection>
    </div>
  );
}
