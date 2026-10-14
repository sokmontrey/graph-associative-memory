import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { MemoryEdge, MemoryNode, MemoryTools } from "../models/memory-graph.ts";

export type MemoryMcpDeps = {
  service: MemoryTools;
};

const SUBAGENT_ONLY =
  "SUBAGENT ONLY. The main agent never calls this directly — it talks to the `memory` subagent, which owns these tools.";

// Results are JSON text: agents parse it, humans read it, nothing to keep in sync.
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function serializeNode(node: MemoryNode) {
  return {
    id: node.id,
    content: node.content,
    kind: node.kind,
    importance: node.importance,
    createdAt: node.createdAt.toISOString(),
    lastReinforcedAt: node.lastReinforcedAt.toISOString(),
  };
}

function serializeEdge(edge: MemoryEdge) {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    description: edge.description,
    strength: edge.strength,
    createdAt: edge.createdAt.toISOString(),
    lastReinforcedAt: edge.lastReinforcedAt.toISOString(),
  };
}

const SERVER_INSTRUCTIONS = `Low-level memory graph tools for the \`memory\` subagent only.

- READ tools are pure: search, recent, top, get, edges. Reading never changes anything.
- WRITE tools: add (server-side dedup), update (re-embeds), link (upsert), forget (cascades).
- REINFORCE tools (reinforceNodes/reinforceEdges) are the ONLY way importance/strength go up.
- tick() runs on a server-side schedule and is not exposed here.

The main agent never calls these. It calls the \`memory\` subagent with MODE: RECALL or MODE: COMMIT (see AGENTS.md).`;

export function createMemoryMcpServer(deps: MemoryMcpDeps): McpServer {
  const { service } = deps;
  const server = new McpServer(
    { name: "associative-graph-memory", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // ---- READ: pure, no side effects ----

  server.registerTool(
    "memory_search",
    {
      title: "Search memories",
      description: `${SUBAGENT_ONLY} Semantic search, ranked by relevance x importance. Read-only.`,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        query: z.string().describe("What to look for."),
        n: z.number().int().min(1).max(50).optional().describe("How many to return (default 10)."),
      }),
    },
    async ({ query, n }) => json((await service.search(query, n)).map(serializeNode))
  );

  server.registerTool(
    "memory_recent",
    {
      title: "Recent memories",
      description: `${SUBAGENT_ONLY} Latest nodes first (createdAt desc). Read-only.`,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        n: z.number().int().min(1).max(50).optional().describe("How many to return (default 10)."),
        kind: z.string().optional().describe("Free-form kind filter."),
      }),
    },
    async ({ n, kind }) => json((await service.recent(n, kind)).map(serializeNode))
  );

  server.registerTool(
    "memory_top",
    {
      title: "Top memories",
      description: `${SUBAGENT_ONLY} Highest importance first. Read-only.`,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        n: z.number().int().min(1).max(50).optional().describe("How many to return (default 10)."),
      }),
    },
    async ({ n }) => json((await service.top(n)).map(serializeNode))
  );

  server.registerTool(
    "memory_get",
    {
      title: "Get memories",
      description: `${SUBAGENT_ONLY} Fetch nodes by id. Read-only.`,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ ids: z.array(z.string()).describe("Node ids.") }),
    },
    async ({ ids }) => json((await service.get(ids)).map(serializeNode))
  );

  server.registerTool(
    "memory_edges",
    {
      title: "Node edges",
      description: `${SUBAGENT_ONLY} Edges touching a node, BOTH directions, strength desc. Read-only.`,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        nodeId: z.string(),
        relation: z.string().optional().describe("Free-form relation filter."),
        query: z.string().optional().describe("Semantic filter over relation + description."),
        n: z.number().int().min(1).max(50).optional(),
      }),
    },
    async ({ nodeId, relation, query, n }) =>
      json((await service.edges(nodeId, { relation, query, n })).map(serializeEdge))
  );

  // ---- WRITE ----

  server.registerTool(
    "memory_add",
    {
      title: "Add memory",
      description: `${SUBAGENT_ONLY} Store one self-contained statement. Server-side dedup: a near-duplicate (cosine > ~0.92) is returned and reinforced instead. Max 5 adds per minute.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        content: z.string().describe("One self-contained statement, readable without context."),
        kind: z.string().describe("Free tag: preference, fact, event, decision, ..."),
      }),
    },
    async ({ content, kind }) => json(serializeNode(await service.add({ content, kind })))
  );

  server.registerTool(
    "memory_update",
    {
      title: "Update memory",
      description: `${SUBAGENT_ONLY} Patch content and/or kind. Content edits re-embed.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        id: z.string(),
        content: z.string().optional(),
        kind: z.string().optional(),
      }),
    },
    async ({ id, content, kind }) => json(serializeNode(await service.update(id, { content, kind })))
  );

  server.registerTool(
    "memory_link",
    {
      title: "Link memories",
      description: `${SUBAGENT_ONLY} Upsert: if the same (from, to, relation) exists it is reinforced instead of duplicated. Description must say WHY the nodes are linked.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        relation: z.string().describe("Free label: supports, contradicts, related_to, evokes, updates, ..."),
        description: z.string().describe("WHY these are linked."),
      }),
    },
    async ({ from, to, relation, description }) =>
      json(serializeEdge(await service.link({ from, to, relation, description })))
  );

  server.registerTool(
    "memory_forget",
    {
      title: "Forget memories",
      description: `${SUBAGENT_ONLY} Delete wrong or obsolete nodes. Cascades to touching edges.`,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({ ids: z.array(z.string()).describe("Node ids to delete.") }),
    },
    async ({ ids }) => {
      await service.forget(ids);
      return json({ ok: true, forgotten: ids });
    }
  );

  // ---- REINFORCE: the ONLY way values go up ----

  server.registerTool(
    "memory_reinforce_nodes",
    {
      title: "Reinforce nodes",
      description: `${SUBAGENT_ONLY} The ONLY way importance goes up. Saturating (diminishing returns). Call for briefing items the main agent actually used.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        ids: z.array(z.string()),
        amount: z.number().min(0).max(1).optional(),
      }),
    },
    async ({ ids, amount }) => {
      await service.reinforceNodes(ids, amount);
      return json({ ok: true, reinforced: ids });
    }
  );

  server.registerTool(
    "memory_reinforce_edges",
    {
      title: "Reinforce edges",
      description: `${SUBAGENT_ONLY} The ONLY way strength goes up. Saturating (diminishing returns). Call for edges connecting two used nodes.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        ids: z.array(z.string()),
        amount: z.number().min(0).max(1).optional(),
      }),
    },
    async ({ ids, amount }) => {
      await service.reinforceEdges(ids, amount);
      return json({ ok: true, reinforced: ids });
    }
  );

  return server;
}
