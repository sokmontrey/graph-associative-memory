// Wire types shared with the dashboard UI (dashboard/src/types.ts mirrors
// these; keep them in sync). Everything is JSON-serializable — dates are ISO
// strings — so the same shapes cross the HTTP boundary and the SSE stream.

export interface WireNode {
  id: string;
  content: string;
  kind: string;
  importance: number;
  createdAt: string;
  lastReinforcedAt: string;
}

export interface WireEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  description: string;
  strength: number;
  createdAt: string;
  lastReinforcedAt: string;
}

export interface StateSnapshot {
  at: number;
  nodes: WireNode[];
  edges: WireEdge[];
  stats: {
    nodes: number;
    edges: number;
    avgImportance: number;
    avgStrength: number;
    byKind: Record<string, number>;
  };
}

// UI-triggerable operations (the low-level MemoryTools, minus tick which is
// server-schedule only). `stats` exists so remote MCP clients can proxy the
// full contract through /api/op.
export type OpName =
  | "search"
  | "recent"
  | "top"
  | "get"
  | "edges"
  | "add"
  | "update"
  | "link"
  | "forget"
  | "reinforceNodes"
  | "reinforceEdges"
  | "stats";

export interface OpRequest {
  op: OpName;
  args?: Record<string, unknown>;
}

// Session scratchpad files (view-only in the dashboard). One short-term
// memory file per chat session; the agent owns them, the graph stays durable.
export interface ScratchListItem {
  name: string;
  mtime: number;
  lines: number;
}

export interface ScratchFile extends ScratchListItem {
  content: string;
}
