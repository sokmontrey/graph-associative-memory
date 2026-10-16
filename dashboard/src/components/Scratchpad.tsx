import { useCallback, useEffect, useState } from "react";
import { fetchScratch, fetchScratchList } from "../api.ts";
import type { ScratchFile, ScratchListItem } from "../types.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.tsx";
import { ScrollArea } from "./ui/scroll-area.tsx";

// View-only session scratchpads, most recent first.
// The agent owns these files; the dashboard only reads them.
export function Scratchpad() {
  const [files, setFiles] = useState<ScratchListItem[]>([]);
  const [budget, setBudget] = useState(30);
  const [selected, setSelected] = useState<ScratchFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchScratchList();
      setFiles(list.files);
      setBudget(list.budgetLines);
      if (selected) {
        try {
          setSelected(await fetchScratch(selected.name));
        } catch {
          setSelected(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useCallback(async (name: string) => {
    setError(null);
    try {
      setSelected(await fetchScratch(name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Scratchpad
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <div className="text-xs text-destructive">{error}</div>}
        {files.length === 0 && !error && (
          <div className="text-xs text-muted-foreground">no scratch files yet</div>
        )}
        <div className="flex flex-wrap gap-1">
          {files.map((f) => (
            <Button
              key={f.name}
              size="sm"
              variant={selected?.name === f.name ? "secondary" : "ghost"}
              onClick={() => void open(f.name)}
              title={`${f.lines}/${budget} lines · ${new Date(f.mtime).toLocaleString()}`}
            >
              {f.name}
              <Badge variant="secondary" className="ml-1">
                {f.lines}/{budget}
              </Badge>
            </Button>
          ))}
        </div>
        {selected && (
          <ScrollArea className="max-h-64 rounded border border-border p-2">
            <pre className="whitespace-pre-wrap text-xs">{selected.content}</pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
