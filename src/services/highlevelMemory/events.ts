// In-process instrumentation for the high-level memory operations. The service
// emits an event per meaningful step; the dashboard subscribes and projects
// them live. Deliberately dependency-free (a listener Set, no Node EventEmitter)
// so the same types work in the browser bundle.

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
