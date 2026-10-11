// Mirrors src/dashboard/protocol.ts and src/services/highlevelMemory/events.ts
// in the main project. Duplicated because the dashboard is a separate package;
// keep the two in sync when the wire format changes.

export type WireStatus = "active" | "invalidated";
export type NodeType = "preference" | "trait" | "observation";
export type EdgeType = "supports" | "contradicts" | "related_to" | "evokes";

export interface WireNode {
  id: string;
  type: NodeType;
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
  type: EdgeType;
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
    nodes: { total: number; active: number; invalidated: number; avgImportance: number; avgValidity: number };
    edges: { total: number; active: number; invalidated: number; avgStrength: number };
    byNodeType: Record<NodeType, number>;
    byEdgeType: Record<EdgeType, number>;
  };
}

export type MemoryOpKind =
  | "getTopImportance"
  | "recall"
  | "remember"
  | "proposeLinks"
  | "connect"
  | "invalidate"
  | "reinstate"
  | "resolveContradiction"
  | "challenge"
  | "corroborate"
  | "reinforce";

export type MemoryEvent =
  | { type: "op:start"; opId: string; op: MemoryOpKind; at: number; args: Record<string, unknown> }
  | { type: "step"; opId: string; op: MemoryOpKind; at: number; phase: string; detail: Record<string, unknown> }
  | { type: "op:end"; opId: string; op: MemoryOpKind; at: number; durationMs: number; result?: unknown; error?: string }
  | { type: "db:changed"; at: number; reason: string };

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
  | "resolveContradiction";
