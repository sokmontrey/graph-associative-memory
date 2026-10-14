import { MEMORY_EDGE_TABLE } from "../db/relations.ts";
import { mapMemoryEdge } from "../models/index.ts";
import type { MemoryStack } from "../stack.ts";
import type { StateSnapshot, WireEdge, WireNode } from "./protocol.ts";

// Full graph snapshot for the dashboard: every node and edge.
export async function buildSnapshot(stack: MemoryStack): Promise<StateSnapshot> {
  const storedNodes = await stack.nodeRepo.findAll();
  const edgeRows = await stack.edgeRepo.list({ table: MEMORY_EDGE_TABLE });
  const edges = edgeRows.map(mapMemoryEdge);

  const wireNodes: WireNode[] = storedNodes.map((node) => ({
    id: node.id,
    content: node.content,
    kind: node.kind,
    importance: node.importance,
    createdAt: node.createdAt.toISOString(),
    lastReinforcedAt: node.lastReinforcedAt.toISOString(),
  }));

  const wireEdges: WireEdge[] = edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    description: edge.description,
    strength: edge.strength,
    createdAt: edge.createdAt.toISOString(),
    lastReinforcedAt: edge.lastReinforcedAt.toISOString(),
  }));

  return {
    at: Date.now(),
    nodes: wireNodes,
    edges: wireEdges,
    stats: await stack.service.stats(),
  };
}
