import { z } from "zod";
import type { GraphRow } from "../repos/graphDb/index.ts";
import type { MemoryEdge, MemoryNode } from "./memory-graph.ts";
import { pickNodeFields } from "./row.ts";

export type { MemoryEdge, MemoryNode, MemoryTools } from "./memory-graph.ts";
export { MEMORY_POLICY, saturatingReinforce } from "./memory-graph.ts";

// All readable/writable MemoryNode properties. Doubles as the NodeRepo
// field allowlist. `embedding` is storage-only (never on MemoryNode).
export const MEMORY_NODE_FIELDS = [
  "id",
  "content",
  "kind",
  "importance",
  "createdAt",
  "lastReinforcedAt",
  "embedding",
] as const;

export const MEMORY_EDGE_PROPS = [
  "id",
  "relation",
  "description",
  "strength",
  "createdAt",
  "lastReinforcedAt",
] as const;

export const MemoryNodeSchema = z.object({
  id: z.string(),
  content: z.string().nullable(),
  kind: z.string().nullable(),
  importance: z.number().nullable(),
  // Epoch milliseconds (INT64 arrives as bigint or number).
  createdAt: z.union([z.number(), z.bigint()]).nullable(),
  lastReinforcedAt: z.union([z.number(), z.bigint()]).nullable(),
  embedding: z.array(z.number()).nullable(),
});

// Upsert shape for LadybugNodeRepo<MemoryNode, ...>. Timestamps are epoch ms.
export interface MemoryNodeUpsert {
  id: string;
  content: string;
  kind: string;
  importance: number;
  createdAt: number;
  lastReinforcedAt: number;
  embedding: number[];
}

export type MemoryNodePatch = Partial<Omit<MemoryNodeUpsert, "id">>;

function toDate(value: number | bigint): Date {
  return new Date(typeof value === "bigint" ? Number(value) : value);
}

function toMemoryNode(parsed: z.infer<typeof MemoryNodeSchema>): MemoryNode {
  if (
    parsed.content === null ||
    parsed.kind === null ||
    parsed.importance === null ||
    parsed.createdAt === null ||
    parsed.lastReinforcedAt === null
  ) {
    throw new Error(`MemoryNode ${parsed.id}: missing required property`);
  }
  return {
    id: parsed.id,
    content: parsed.content,
    kind: parsed.kind,
    importance: parsed.importance,
    createdAt: toDate(parsed.createdAt),
    lastReinforcedAt: toDate(parsed.lastReinforcedAt),
  };
}

export function mapMemoryNode(row: GraphRow, alias = "m"): MemoryNode {
  return toMemoryNode(MemoryNodeSchema.parse(pickNodeFields(row, alias, MEMORY_NODE_FIELDS)));
}

// Neighbor rows carry `m_<prop>` keys (see EdgeRepo.neighbors).
export function mapMemoryNeighbor(row: GraphRow): MemoryNode {
  const picked: Record<string, unknown> = {};
  for (const field of MEMORY_NODE_FIELDS) {
    picked[field] = row[`m_${field}`] ?? null;
  }
  return toMemoryNode(MemoryNodeSchema.parse(picked));
}

// EdgeRepo rows carry `from_id`, `to_id`, plus `e_<prop>` per registered prop.
const MemoryEdgeRowSchema = z.object({
  from_id: z.string(),
  to_id: z.string(),
  e_id: z.string(),
  e_relation: z.string(),
  e_description: z.string(),
  e_strength: z.number(),
  e_createdAt: z.union([z.number(), z.bigint()]),
  e_lastReinforcedAt: z.union([z.number(), z.bigint()]),
});

export function mapMemoryEdge(row: GraphRow): MemoryEdge {
  const parsed = MemoryEdgeRowSchema.parse(row);
  return {
    id: parsed.e_id,
    from: parsed.from_id,
    to: parsed.to_id,
    relation: parsed.e_relation,
    description: parsed.e_description,
    strength: parsed.e_strength,
    createdAt: toDate(parsed.e_createdAt),
    lastReinforcedAt: toDate(parsed.e_lastReinforcedAt),
  };
}
