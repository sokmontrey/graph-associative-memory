// Wire types shared with the dashboard UI (dashboard/src/types.ts mirrors
// these; keep them in sync). Everything is JSON-serializable — dates are ISO
// strings — so the same shapes cross the HTTP boundary and the SSE stream.

export type WireStatus = "active" | "invalidated";

export interface WireNode {
  id: string;
  type: "preference" | "trait" | "observation";
  description: string;
  importance: number;
  validity: number;
  status: WireStatus;
  rank: number;
  lastReinforce: string;
  invalidatedAt: string | null;
  invalidateReason: string | null;
  supersededBy: string | null;
}

export interface WireEdge {
  id: string;
  from: string;
  to: string;
  type: "supports" | "contradicts" | "related_to" | "evokes";
  description: string;
  strength: number;
  status: WireStatus;
  lastReinforce: string;
  invalidatedAt: string | null;
  invalidateReason: string | null;
}

export interface StateSnapshot {
  at: number;
  nodes: WireNode[];
  edges: WireEdge[];
  stats: {
    nodes: {
      total: number;
      active: number;
      invalidated: number;
      avgImportance: number;
      avgValidity: number;
    };
    edges: {
      total: number;
      active: number;
      invalidated: number;
      avgStrength: number;
    };
    byNodeType: Record<"preference" | "trait" | "observation", number>;
    byEdgeType: Record<"supports" | "contradicts" | "related_to" | "evokes", number>;
  };
}

// UI-triggerable operations (also what an agent would do, minus the MCP layer).
// `inspect` / `stats` / `setValidity` exist so remote MCP clients can proxy the
// full HighlevelMemoryService contract through /api/op.
export type OpName =
  | "getTopImportance"
  | "recall"
  | "remember"
  | "proposeLinks"
  | "connect"
  | "reinforce"
  | "challenge"
  | "corroborate"
  | "invalidate"
  | "reinstate"
  | "resolveContradiction"
  | "inspect"
  | "stats"
  | "setValidity";

export interface OpRequest {
  op: OpName;
  args?: Record<string, unknown>;
}
