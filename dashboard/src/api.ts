import type { MemoryEvent, OpName, StateSnapshot } from "./types.ts";

export async function fetchState(): Promise<StateSnapshot> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`state ${res.status}`);
  return (await res.json()) as StateSnapshot;
}

export async function runOp(op: OpName, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch("/api/op", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body && body.ok === false)) {
    throw new Error(body?.error ?? `op ${op} failed (${res.status})`);
  }
  return body?.result;
}

export async function tick(): Promise<void> {
  await fetch("/api/tick", { method: "POST" });
}

export function subscribe(
  onEvent: (event: MemoryEvent) => void,
  onStatus?: (connected: boolean) => void
): () => void {
  const source = new EventSource("/api/stream");
  source.onopen = () => onStatus?.(true);
  source.onerror = () => onStatus?.(false);
  source.addEventListener("memory", (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent).data) as MemoryEvent);
    } catch {
      /* ignore malformed frame */
    }
  });
  return () => source.close();
}
