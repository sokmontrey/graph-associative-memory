import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { MemoryEdge, MemoryNode, MemoryNodeType } from "../models/memory.ts";
import { memoryRank } from "../models/memory.ts";
import type { MemoryService } from "../services/graphMemory/index.ts";
import type { HighlevelMemoryService } from "../services/highlevelMemory/highlevelMemoryService.ts";
import type { MemoryEventBus } from "../services/highlevelMemory/events.ts";

export type MemoryMcpDeps = {
  highlevel: HighlevelMemoryService;
  service: MemoryService;
  events?: MemoryEventBus;
};

const NODE_TYPES = ["preference", "trait", "observation"] as const;
const EDGE_TYPES = ["supports", "contradicts", "related_to", "evokes"] as const;
const TYPE_FILTER = [...NODE_TYPES, "all"] as const;

const GUIDE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "AGENT.md");

// Results are JSON text: agents parse it, humans read it, nothing to keep in sync.
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function serializeNode(node: MemoryNode) {
  return {
    id: node.id,
    type: node.type,
    description: node.description,
    importance: node.importance,
    validity: node.validity,
    status: node.status,
    rank: memoryRank(node),
    lastReinforce: node.last_reinforce.toISOString(),
    invalidatedAt: node.invalidated_at?.toISOString() ?? null,
    invalidateReason: node.invalidate_reason,
    supersededBy: node.superseded_by,
  };
}

function serializeEdge(edge: MemoryEdge) {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    description: edge.description,
    strength: edge.strength,
    status: edge.status,
    lastReinforce: edge.last_reinforce.toISOString(),
    invalidatedAt: edge.invalidated_at?.toISOString() ?? null,
    invalidateReason: edge.invalidate_reason,
  };
}

const SERVER_INSTRUCTIONS = `This server exposes an associative memory graph with two independent axes.

- Salience (importance/strength) decays over time; use memory_reinforce / memory_recall to strengthen what matters.
- Validity (0..1) is believed-ness. Surfacing rank = importance x validity. Use memory_challenge for soft doubt, memory_corroborate for support, and memory_invalidate for a decisive retirement (soft tombstone; reversible with memory_reinstate).

Mindful-use session loop (never forget, never overuse):
- START (once per task): memory_stats only if the graph size matters, then memory_get_top_importance once with n <= 10 (use semanticQuery to narrow by topic). Do NOT poll top every turn.
- MIDDLE (only when needed): memory_recall only to explain how two ideas connect before explaining it — NOT as a lookup/search. Max 1-2 recalls per question; add searchHints if the path is empty.
- END (only for durable facts): memory_remember in one batch with small atomic descriptions (one fact per memory, not composites; check semanticQuery first to avoid duplicates). Then memory_propose_links ONCE per batch (prefer focusId; fall back to manual memory_connect if propose fails). Connect only links you can justify; drop the rest.
- CONFLICT (only on evidence): memory_challenge for soft doubt, memory_corroborate for independent support, memory_resolve_contradiction for a decided head-to-head (proposal contradiction.favoredId suggests, you decide), memory_invalidate only when you know it is wrong.

When two memories conflict, memory_propose_links returns { contradiction: { favoredId } } from the grounded model. Adjudicate with memory_resolve_contradiction(keepId, dropId, rationale): the winner is reinforced and the loser is retired (superseded_by = winner). Read memory://agent-guide for the full mental model and test scenarios.`;

export function createMemoryMcpServer(deps: MemoryMcpDeps): McpServer {
  const { highlevel, service } = deps;
  const server = new McpServer(
    { name: "associative-graph-memory", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // --- Reads ---------------------------------------------------------------

  server.registerTool(
    "memory_get_top_importance",
    {
      title: "Top memories",
      description:
        "Return the most important memories (rank = importance x validity). Pass `semanticQuery` to order by similarity to a topic (closest description first). Call once at task start / before answering from past knowledge. Do NOT call every turn and keep n <= 10. Skip when answering from conversation context alone.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        type: z.enum(TYPE_FILTER).describe("Node kind filter, or 'all'."),
        n: z.number().int().min(1).max(100).describe("How many memories to return. Keep n <= 10."),
        semanticQuery: z
          .string()
          .optional()
          .describe(
            "Optional topic; candidates come from semantic search, ordered by similarity. Only matches above a similarity floor are returned, so an unrelated topic may return fewer than n (even zero) instead of padding with unrelated memories. Prefer this over a large n."
          ),
      }),
    },
    async ({ type, n, semanticQuery }) => {
      const nodes = await highlevel.getTopImportance(type, n, semanticQuery);
      return json({ memories: nodes.map(serializeNode) });
    }
  );

  server.registerTool(
    "memory_recall",
    {
      title: "Associative recall",
      description:
        "Walk the graph from `initialIdea` toward `goalIdea`, strengthening the edges on the path (NOT a pure read — each call mutates strength). Call only to reconstruct how two ideas connect before explaining it. Do NOT use as lookup/search; use memory_get_top_importance with semanticQuery for that. Budget 1-2 recalls per question; add `searchHints` if the path is empty instead of retrying blindly.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        initialIdea: z.string().describe("Where to start the walk."),
        goalIdea: z.string().describe("Where to try to reach."),
        searchHints: z
          .array(z.string())
          .optional()
          .describe("Intermediate phrases that bridge the two ideas."),
      }),
    },
    async ({ initialIdea, goalIdea, searchHints }) => {
      const result = await highlevel.recall(initialIdea, goalIdea, searchHints);
      return json({
        anchors: result.anchors.map(serializeNode),
        goals: result.goals.map(serializeNode),
        path: result.path.map((step) => ({
          fromId: step.fromId,
          edge: serializeEdge(step.edge),
          to: serializeNode(step.to),
        })),
      });
    }
  );

  server.registerTool(
    "memory_stats",
    {
      title: "Memory stats",
      description:
        "Whole-graph counts and averages, including active vs invalidated. Call once to gauge the graph before a larger operation (e.g. empty graph vs populated). Do NOT call every turn or before every read.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({}),
    },
    async () => json(await highlevel.stats())
  );

  server.registerTool(
    "memory_get_node",
    {
      title: "Inspect a memory",
      description:
        "Fetch one memory with its incident edges and neighbors (active and invalidated). Call after recall/proposeLinks to see a node's local structure and status before you connect/challenge/resolve. Do NOT scan the graph with repeated get_node calls; use memory_get_top_importance to shortlist first.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ id: z.string().describe("Memory id.") }),
    },
    async ({ id }) => {
      const inspection = await highlevel.inspect(id);
      return json({
        node: inspection.node ? serializeNode(inspection.node) : null,
        outEdges: inspection.outEdges.map(serializeEdge),
        inEdges: inspection.inEdges.map(serializeEdge),
        neighbors: inspection.neighbors.map(serializeNode),
      });
    }
  );

  // --- Writes --------------------------------------------------------------

  server.registerTool(
    "memory_remember",
    {
      title: "Remember",
      description:
        "Store a new memory with the links you already understand. `direction: 'out'` puts the new node on the from side; `'in'` on the to side. Call only for durable facts (preference/trait/long-lived observation) at the end of a task, in one batch with small ATOMIC descriptions (one fact per memory, not composites; check memory_get_top_importance with semanticQuery first to avoid duplicates). Do NOT store ephemeral chat. After the batch, call memory_propose_links once to find further links.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        type: z.enum(NODE_TYPES).describe("Node kind."),
        description: z.string().describe("The memory content. Keep atomic: one fact per memory."),
        links: z
          .array(
            z.object({
              otherNodeId: z.string().describe("Existing memory to link to."),
              direction: z.enum(["out", "in"]).describe("Which side the new node is on."),
              edgeType: z.enum(EDGE_TYPES),
              description: z.string().describe("Why these are linked."),
            })
          )
          .describe("Links you can justify now (may be empty)."),
      }),
    },
    async ({ type, description, links }) => {
      const result = await highlevel.remember(type, description, links);
      return json({
        node: serializeNode(result.node),
        edges: result.edges.map(serializeEdge),
      });
    }
  );

  server.registerTool(
    "memory_propose_links",
    {
      title: "Propose links",
      description:
        "Ask the grounded model to propose links (calls an external model — expensive, use sparingly). Call ONCE per batch of new memories. With `focusId`, evaluates that memory against its semantic neighbors (works regardless of prior calls); without it, uses the active buffer (recently remembered + last-recalled memories). Do NOT poll or retry on empty results — connect manually instead. Each proposal includes the relation, direction, confidence, evidence, and — for contradictions — a `contradiction.favoredId`. Feed `proposal.link` into memory_connect only for links you can justify (drop the rest), or contradictions into memory_resolve_contradiction.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        focusId: z.string().optional().describe("Memory to evaluate against its semantic neighbors. Prefer this after a batch."),
        limit: z.number().int().min(1).max(100).optional().describe("Max candidate pairs. Keep small (default 20 is plenty)."),
      }),
    },
    async ({ focusId, limit }) => {
      const proposals = await highlevel.proposeLinks({ focusId, limit });
      return json({
        proposals: proposals.map((proposal) => ({
          link: proposal.link,
          confidence: proposal.confidence,
          evidence: proposal.evidence,
          from: serializeNode(proposal.nodes.from),
          to: serializeNode(proposal.nodes.to),
          contradiction: proposal.contradiction ?? null,
        })),
      });
    }
  );

  server.registerTool(
    "memory_connect",
    {
      title: "Connect",
      description:
        "Commit a link you can justify (usually a proposal from memory_propose_links with a description you write). Stored from -> to. Call selectively — only for justified links, never to re-add a live link. Next: stop; do NOT follow with a redundant propose_links.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        fromId: z.string(),
        toId: z.string(),
        edgeType: z.enum(EDGE_TYPES),
        description: z.string().describe("Why these are linked."),
      }),
    },
    async ({ fromId, toId, edgeType, description }) => {
      const edge = await highlevel.connect({ fromId, toId, edgeType, description });
      return json(serializeEdge(edge));
    }
  );

  server.registerTool(
    "memory_reinforce",
    {
      title: "Reinforce",
      description:
        "Bump a memory's salience (importance). Call only after a memory proves useful or survives a challenge — never speculatively or in a loop.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        memoryId: z.string(),
        strength: z.number().min(0).max(1).optional().describe("Defaults to the standard increment."),
      }),
    },
    async ({ memoryId, strength }) => json(serializeNode(await highlevel.reinforce(memoryId, strength)))
  );

  // --- Belief maintenance --------------------------------------------------

  server.registerTool(
    "memory_challenge",
    {
      title: "Challenge",
      description:
        "Soft doubt: lower a memory's validity without retiring it. Call only when evidence casts doubt but does not settle the question; use memory_resolve_contradiction when it does. Do NOT challenge repeatedly without new evidence.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        memoryId: z.string(),
        reason: z.string().describe("What casts doubt."),
      }),
    },
    async ({ memoryId, reason }) => json(serializeNode(await highlevel.challenge(memoryId, reason)))
  );

  server.registerTool(
    "memory_corroborate",
    {
      title: "Corroborate",
      description:
        "Support a memory: raise its validity and reinforce its salience. Call only when independent evidence agrees with a memory — never as a routine follow-up to every recall.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({ memoryId: z.string(), reason: z.string().optional() }),
    },
    async ({ memoryId, reason }) =>
      json(serializeNode(await highlevel.corroborate(memoryId, reason)))
  );

  server.registerTool(
    "memory_invalidate",
    {
      title: "Invalidate",
      description:
        "Decisively retire a memory or connection: soft tombstone, excluded from every surfacing path, reversible with memory_reinstate. Call only when you know a memory is wrong; use memory_resolve_contradiction when it lost a head-to-head conflict, memory_challenge when unsure.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        nodeId: z.string().optional().describe("Memory to retire (provide exactly one of nodeId/edgeId)."),
        edgeId: z.string().optional().describe("Connection to retire."),
        reason: z.string().describe("Why it is retired (kept for audit)."),
        supersededBy: z.string().optional().describe("Id of the memory that replaced it."),
      }),
    },
    async ({ nodeId, edgeId, reason, supersededBy }) => {
      if ((nodeId === undefined) === (edgeId === undefined)) {
        return fail("Provide exactly one of nodeId or edgeId.");
      }
      const result =
        nodeId !== undefined
          ? await highlevel.invalidate({ nodeId }, reason, supersededBy)
          : await highlevel.invalidate({ edgeId: edgeId! }, reason);
      return json(
        result.kind === "node"
          ? { kind: "node", node: serializeNode(result.node!) }
          : { kind: "edge", edge: serializeEdge(result.edge!) }
      );
    }
  );

  server.registerTool(
    "memory_reinstate",
    {
      title: "Reinstate",
      description:
        "Undo an invalidation: restore a memory or connection to active (validity reset to full for nodes). Call only when you decide the agent was wrong to retire it — not as a routine toggle.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        nodeId: z.string().optional().describe("Memory to restore (exactly one of nodeId/edgeId)."),
        edgeId: z.string().optional().describe("Connection to restore."),
        reason: z.string().optional(),
      }),
    },
    async ({ nodeId, edgeId, reason }) => {
      if ((nodeId === undefined) === (edgeId === undefined)) {
        return fail("Provide exactly one of nodeId or edgeId.");
      }
      const result =
        nodeId !== undefined
          ? await highlevel.reinstate({ nodeId }, reason)
          : await highlevel.reinstate({ edgeId: edgeId! }, reason);
      return json(
        result.kind === "node"
          ? { kind: "node", node: serializeNode(result.node!) }
          : { kind: "edge", edge: serializeEdge(result.edge!) }
      );
    }
  );

  server.registerTool(
    "memory_resolve_contradiction",
    {
      title: "Resolve contradiction",
      description:
        "Adjudicate a head-to-head conflict: reinforce `keepId`, retire `dropId` (superseded_by = keepId), and record the rationale on a contradicts edge. Call only for a decided conflict with a written rationale — you decide, contradiction.favoredId only suggests. Get candidates from memory_propose_links (contradiction.favoredId) or a recall path. When unsure, use memory_challenge instead.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        keepId: z.string().describe("The memory that wins."),
        dropId: z.string().describe("The memory that loses (retired)."),
        rationale: z.string().describe("Why the winner wins."),
        evidence: z
          .record(z.string(), z.number())
          .optional()
          .describe("Grounding probabilities backing the call."),
      }),
    },
    async ({ keepId, dropId, rationale, evidence }) => {
      const result = await highlevel.resolveContradiction(keepId, dropId, rationale, evidence);
      return json({
        kept: serializeNode(result.kept),
        dropped: serializeNode(result.dropped),
        edge: serializeEdge(result.edge),
      });
    }
  );

  // --- Guide surface -------------------------------------------------------

  server.registerResource(
    "agent-guide",
    "memory://agent-guide",
    {
      title: "Associative memory agent guide",
      description:
        "The mental model, tool reference, contradiction loop, and scripted test scenarios.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(GUIDE_PATH, "utf8") }],
    })
  );

  server.registerPrompt(
    "memory-session",
    {
      title: "Run a memory test session",
      description: "Seed the conversation with a scripted end-to-end memory test.",
      argsSchema: z.object({
        topic: z.string().optional().describe("Optional domain to frame the session around."),
      }),
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Read the memory://agent-guide resource, then run its "contradiction resolution" ` +
              `test scenario${topic ? ` around: ${topic}` : ""}. Use the memory_* tools, and after each ` +
              `step report what changed (status/validity/rank).`,
          },
        },
      ],
    })
  );

  return server;
}
