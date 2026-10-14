import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { OpName } from "../types.ts";
import type { Selection } from "./Inspector.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { CollapsibleSection } from "./ui/collapsible-section.tsx";
import { Badge } from "./ui/badge.tsx";

export function Controls({
  selection,
  onRun,
  busy,
  error,
}: {
  selection: Selection;
  onRun: (op: OpName, args: Record<string, unknown>) => void;
  busy: boolean;
  error: string | null;
}) {
  const selectedNodeId = selection?.kind === "node" ? selection.id : "";
  const selectedEdgeId = selection?.kind === "edge" ? selection.id : "";

  const [query, setQuery] = useState("");
  const [searchN, setSearchN] = useState(10);
  const [recentN, setRecentN] = useState(10);
  const [recentKind, setRecentKind] = useState("");
  const [topN, setTopN] = useState(10);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("");
  const [updateId, setUpdateId] = useState("");
  const [updateContent, setUpdateContent] = useState("");
  const [updateKind, setUpdateKind] = useState("");
  const [linkFrom, setLinkFrom] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [relation, setRelation] = useState("");
  const [linkDesc, setLinkDesc] = useState("");
  const [edgesId, setEdgesId] = useState("");
  const [edgesRelation, setEdgesRelation] = useState("");
  const [edgesQuery, setEdgesQuery] = useState("");
  const [forgetIds, setForgetIds] = useState("");
  const [reNodeIds, setReNodeIds] = useState("");
  const [reEdgeIds, setReEdgeIds] = useState("");

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

      <CollapsibleSection title="Search" description="Semantic, relevance × importance" defaultOpen>
        <div className="grid gap-1.5">
          <Input placeholder="query" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="flex gap-1.5">
            <Input
              type="number"
              min={1}
              max={50}
              value={searchN}
              onChange={(e) => setSearchN(Number(e.target.value))}
              className="w-16"
            />
            <Button
              className="flex-1"
              disabled={busy || !query.trim()}
              onClick={() => onRun("search", { query, n: searchN })}
            >
              Search
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Recent / top" description="Browse by time or importance">
        <div className="grid gap-1.5">
          <div className="flex gap-1.5">
            <Input
              type="number"
              min={1}
              max={50}
              value={recentN}
              onChange={(e) => setRecentN(Number(e.target.value))}
              className="w-16"
            />
            <Input
              placeholder="kind (optional)"
              value={recentKind}
              onChange={(e) => setRecentKind(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onRun("recent", { n: recentN, kind: recentKind || undefined })}
            >
              Recent
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Input
              type="number"
              min={1}
              max={50}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="w-16"
            />
            <Button className="flex-1" variant="secondary" disabled={busy} onClick={() => onRun("top", { n: topN })}>
              Top
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Add" description="Store one statement (dedups)">
        <div className="grid gap-1.5">
          <Textarea placeholder="content — one self-contained statement" value={content} onChange={(e) => setContent(e.target.value)} rows={2} />
          <div className="flex gap-1.5">
            <Input placeholder="kind (free tag)" value={kind} onChange={(e) => setKind(e.target.value)} className="flex-1" />
            <Button disabled={busy || !content.trim() || !kind.trim()} onClick={() => onRun("add", { content, kind })}>
              Add
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Update" description="Patch content and/or kind">
        <div className="grid gap-1.5">
          <Input
            placeholder={selectedNodeId ? `id ${selectedNodeId.slice(0, 8)}` : "node id (or selected)"}
            value={updateId}
            onChange={(e) => setUpdateId(e.target.value)}
          />
          <Textarea placeholder="new content (optional)" value={updateContent} onChange={(e) => setUpdateContent(e.target.value)} rows={2} />
          <div className="flex gap-1.5">
            <Input placeholder="new kind (optional)" value={updateKind} onChange={(e) => setUpdateKind(e.target.value)} className="flex-1" />
            <Button
              variant="secondary"
              disabled={busy || (!updateContent.trim() && !updateKind.trim())}
              onClick={() =>
                onRun("update", {
                  id: nodeArg(updateId),
                  content: updateContent.trim() || undefined,
                  kind: updateKind.trim() || undefined,
                })
              }
            >
              Update
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Link / edges" description="Upsert links, browse both directions">
        <div className="grid gap-1.5">
          <div className="flex gap-1.5">
            <Input placeholder="from id" value={linkFrom} onChange={(e) => setLinkFrom(e.target.value)} className="flex-1" />
            <Input placeholder="to id" value={linkTo} onChange={(e) => setLinkTo(e.target.value)} className="flex-1" />
          </div>
          <div className="flex gap-1.5">
            <Input placeholder="relation (free label)" value={relation} onChange={(e) => setRelation(e.target.value)} className="flex-1" />
          </div>
          <Input placeholder="why linked (description)" value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} />
          <Button
            variant="secondary"
            disabled={busy || !nodeArg(linkFrom) || !linkTo || !relation.trim() || !linkDesc.trim()}
            onClick={() => onRun("link", { from: nodeArg(linkFrom), to: linkTo, relation, description: linkDesc })}
          >
            Link
          </Button>
        </div>
        <div className="mt-2 grid gap-1.5">
          <div className="grid gap-1">
            <Label>Edges of node (both directions)</Label>
            <Input
              placeholder={selectedNodeId ? `node ${selectedNodeId.slice(0, 8)}` : "node id (or selected)"}
              value={edgesId}
              onChange={(e) => setEdgesId(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5">
            <Input placeholder="relation filter" value={edgesRelation} onChange={(e) => setEdgesRelation(e.target.value)} className="flex-1" />
            <Input placeholder="semantic filter" value={edgesQuery} onChange={(e) => setEdgesQuery(e.target.value)} className="flex-1" />
          </div>
          <Button
            variant="outline"
            disabled={busy || !nodeArg(edgesId)}
            onClick={() =>
              onRun("edges", {
                nodeId: nodeArg(edgesId),
                relation: edgesRelation.trim() || undefined,
                query: edgesQuery.trim() || undefined,
              })
            }
          >
            Show edges
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Forget" description="Delete nodes (cascades edges)">
        <div className="flex gap-1.5">
          <Input
            placeholder={selectedNodeId ? `id ${selectedNodeId.slice(0, 8)}` : "comma-separated ids (or selected)"}
            value={forgetIds}
            onChange={(e) => setForgetIds(e.target.value)}
            className="flex-1"
          />
          <Button
            variant="destructive"
            disabled={busy || (!forgetIds.trim() && !selectedNodeId)}
            onClick={() =>
              onRun("forget", {
                ids: forgetIds.trim() ? forgetIds.split(",").map((s) => s.trim()).filter(Boolean) : [selectedNodeId],
              })
            }
          >
            Forget
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Reinforce" description="The only way values go up">
        <div className="grid gap-1.5">
          <div className="flex gap-1.5">
            <Input
              placeholder={selectedNodeId ? `node ${selectedNodeId.slice(0, 8)}` : "node ids, comma-separated"}
              value={reNodeIds}
              onChange={(e) => setReNodeIds(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || (!reNodeIds.trim() && !selectedNodeId)}
              onClick={() =>
                onRun("reinforceNodes", {
                  ids: reNodeIds.trim() ? reNodeIds.split(",").map((s) => s.trim()).filter(Boolean) : [selectedNodeId],
                })
              }
            >
              Nodes
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Input
              placeholder={selectedEdgeId ? `edge ${selectedEdgeId.slice(0, 8)}` : "edge ids, comma-separated"}
              value={reEdgeIds}
              onChange={(e) => setReEdgeIds(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || (!reEdgeIds.trim() && !selectedEdgeId)}
              onClick={() =>
                onRun("reinforceEdges", {
                  ids: reEdgeIds.trim() ? reEdgeIds.split(",").map((s) => s.trim()).filter(Boolean) : [selectedEdgeId],
                })
              }
            >
              Edges
            </Button>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
