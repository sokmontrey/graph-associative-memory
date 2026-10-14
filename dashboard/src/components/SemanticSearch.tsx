import { useState } from "react";
import { Search } from "lucide-react";
import { runOp } from "../api.ts";
import type { WireNode } from "../types.ts";
import { Input } from "./ui/input.tsx";
import { Button } from "./ui/button.tsx";

// Search row designed to live inside the bottom command bar (the parent
// provides the pill container). Emits matching node ids to filter/highlight
// the graph via search { query, n }.
export function SemanticSearch({
  onResults,
  busy,
}: {
  onResults: (label: string, ids: string[]) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [n, setN] = useState(8);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    try {
      const result = (await runOp("search", { query: q, n })) as WireNode[];
      const ids = Array.isArray(result) ? result.map((node) => node.id) : [];
      onResults(`search “${q.length > 60 ? `${q.slice(0, 59)}…` : q}”`, ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void search();
        }}
        placeholder="Semantic search memories…"
        className="h-7 min-w-[120px] flex-1 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none"
      />
      <Input
        type="number"
        min={1}
        max={50}
        aria-label="N"
        title="Closest N"
        value={n}
        onChange={(e) => setN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        className="h-7 w-12 shrink-0 border-0 bg-secondary/70 px-1.5 text-center shadow-none"
      />
      <Button
        size="sm"
        className="shrink-0 rounded-full"
        onClick={() => void search()}
        disabled={busy || running || !query.trim()}
      >
        {running ? "…" : "Search"}
      </Button>
      {error && (
        <div className="absolute bottom-full left-0 mb-2 w-max max-w-72 truncate rounded-lg border border-destructive/40 bg-background px-3 py-1.5 text-[11px] text-destructive shadow-lg" title={error}>
          search failed: {error}
        </div>
      )}
    </div>
  );
}
