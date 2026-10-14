// Mirrors src/dashboard/protocol.ts and src/services/memory/events.ts
// in the main project. Duplicated because the dashboard is a separate package;
// keep the two in sync when the wire format changes.

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

export type MemoryOpKind =
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
  | "tick";

export type MemoryEvent =
  | { type: "op:start"; opId: string; op: MemoryOpKind; at: number; args: Record<string, unknown> }
  | { type: "step"; opId: string; op: MemoryOpKind; at: number; phase: string; detail: Record<string, unknown> }
  | { type: "op:end"; opId: string; op: MemoryOpKind; at: number; durationMs: number; result?: unknown; error?: string }
  | { type: "db:changed"; at: number; reason: string };

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
