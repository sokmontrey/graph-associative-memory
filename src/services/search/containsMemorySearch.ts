import { MEMORY_NODE_LABEL } from "../../db/relations.ts";
import type { GraphDbRepo } from "../../repos/graphDb/index.ts";
import type { MemorySearchHit, MemorySearchProvider } from "./index.ts";

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
}

// Offline lexical fallback: token-OR CONTAINS with hit-count scoring. No
// model, no extension — used when embeddings are unavailable.
export class ContainsMemorySearch implements MemorySearchProvider {
  private readonly db: GraphDbRepo;
  private readonly nodeLabel: string;

  constructor(db: GraphDbRepo, nodeLabel: string = MEMORY_NODE_LABEL) {
    this.db = db;
    this.nodeLabel = nodeLabel;
  }

  async searchNodes(query: string, limit: number): Promise<MemorySearchHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const params: Record<string, string> = {};
    const clauses = tokens.map((token, i) => {
      params[`t_${i}`] = token;
      return `toLower(m.content) CONTAINS $t_${i}`;
    });
    const rows = await this.db.query(
      `MATCH (m:${this.nodeLabel}) WHERE ${clauses.join(" OR ")} RETURN m.id AS id, m.content AS content;`,
      params
    );
    return rows
      .map((row) => {
        const text = String(row["content"] ?? "").toLowerCase();
        const matched = tokens.filter((token) => text.includes(token)).length;
        return { id: String(row["id"]), score: matched / tokens.length };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit));
  }
}
