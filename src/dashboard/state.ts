import { MEMORY_EDGE_TABLE } from "../db/relations.ts";
import { memoryRank, mapMemoryEdge } from "../models/memory.ts";
import type { MemoryStack } from "../index.ts";
import type { StateSnapshot, WireEdge, WireNode } from "./protocol.ts";

// Full graph snapshot for the dashboard: every node and edge, including soft
// tombstones, so invalidated rows can be drawn (and toggled) rather than vanish.
// Values are projected through the lazy-decay clock (pure, no writes) so the
// display reflects pending decay; watermarks catch up on next settle.
export async function buildSnapshot(stack: MemoryStack): Promise<StateSnapshot> {
  const storedNodes = await stack.nodeRepo.findAll();
  const nodes = stack.service.projectSettledNodes(storedNodes);
  const edgeRows = await stack.edgeRepo.list({ table: MEMORY_EDGE_TABLE });
  const edges = stack.service.projectSettledEdges(edgeRows.map(mapMemoryEdge));

  const wireNodes: WireNode[] = nodes.map((node) => ({
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
  }));

  const wireEdges: WireEdge[] = edges.map((edge) => ({
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
  }));

  return {
    at: Date.now(),
    nodes: wireNodes,
    edges: wireEdges,
    stats: await stack.highlevel.stats(),
  };
}
