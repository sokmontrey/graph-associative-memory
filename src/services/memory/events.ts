// In-process instrumentation for the low-level memory tools. The service
// emits an event per op; the dashboard subscribes and projects them live.
// Deliberately dependency-free so the same types work in the browser bundle.

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

export interface MemoryEventBus {
  emit(event: MemoryEvent): void;
  subscribe(listener: (event: MemoryEvent) => void): () => void;
}

export function createMemoryEventBus(): MemoryEventBus {
  const listeners = new Set<(event: MemoryEvent) => void>();
  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Default when no bus is injected: the service still runs, emitting nothing.
export const NOOP_MEMORY_EVENTS: MemoryEventBus = {
  emit() {},
  subscribe() {
    return () => {};
  },
};
