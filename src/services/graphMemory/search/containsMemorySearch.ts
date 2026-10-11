import {
  MEMORY_EDGE_TABLE,
  MEMORY_NODE_LABEL,
} from "../../../db/relations.ts";
import type { GraphDbRepo } from "../../../repos/graphDb/index.ts";
import type { MemorySearchHit, MemorySearchProvider } from "./index.ts";

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
}

// Offline lexical fallback: token-AND CONTAINS with hit-count scoring. No
// model, no extension — used when embeddings are unavailable.
export class ContainsMemorySearch implements MemorySearchProvider {
  private readonly db: GraphDbRepo;
  private readonly nodeLabel: string;
  private readonly edgeTable: string;

  constructor(
    db: GraphDbRepo,
    nodeLabel: string = MEMORY_NODE_LABEL,
    edgeTable: string = MEMORY_EDGE_TABLE
  ) {
    this.db = db;
    this.nodeLabel = nodeLabel;
    this.edgeTable = edgeTable;
  }

  async searchNodes(query: string, limit: number): Promise<MemorySearchHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const params: Record<string, string> = {};
    const clauses = tokens.map((token, i) => {
      params[`t_${i}`] = token;
      return `toLower(m.description) CONTAINS $t_${i}`;
    });
    const rows = await this.db.query(
      `MATCH (m:${this.nodeLabel}) WHERE ${clauses.join(" OR ")} RETURN m.id AS id, m.description AS description;`,
      params
    );
    return this.rank(rows, tokens, limit);
  }

  async searchEdges(memoryId: string, query: string, limit: number): Promise<MemorySearchHit[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const params: Record<string, string> = { id: memoryId };
    const clauses = tokens.map((token, i) => {
      params[`t_${i}`] = token;
      return `toLower(e.description) CONTAINS $t_${i}`;
    });
    const rows = await this.db.query(
      `MATCH (a:${MEMORY_NODE_LABEL} {id: $id})-[e:${this.edgeTable}]->(b) WHERE ${clauses.join(" OR ")} RETURN e.id AS id, e.description AS description;`,
      params
    );
    return this.rank(rows, tokens, limit);
  }

  private rank(
    rows: Array<Record<string, unknown>>,
    tokens: string[],
    limit: number
  ): MemorySearchHit[] {
    return rows
      .map((row) => {
        const text = String(row["description"] ?? "").toLowerCase();
        const matched = tokens.filter((token) => text.includes(token)).length;
        return { id: String(row["id"]), score: matched / tokens.length };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit));
  }
}
