import { z } from "zod";
import { MEMORY_STATUSES, type MemoryStatus } from "../db/relations.ts";
import type { GraphRow } from "../repos/graphDb/index.ts";
import { pickNodeFields } from "./row.ts";

export type { MemoryStatus } from "../db/relations.ts";

export type MemoryNodeType =
    | 'preference'
    | 'trait'
    | 'observation';

export interface MemoryNode {
    id: string;
    type: MemoryNodeType;
    description: string;
    importance: number;       // salience: half-life value
    validity: number;         // believed-ness 0..1; decays, multiplies into rank
    status: MemoryStatus;     // active | invalidated (soft tombstone)
    last_reinforce: Date;
    invalidated_at: Date | null;
    invalidate_reason: string | null;
    superseded_by: string | null;   // id of the memory that replaced this one
}

export type MemoryEdge =
    | SupportsEdge
    | ContradictsEdge
    | RelatedToEdge
    | EvokesEdge;

// New memories start active with full validity; those are not caller inputs.
export type NewMemoryNode = Omit<
    MemoryNode,
    'id' | 'importance' | 'validity' | 'status' | 'last_reinforce' | 'invalidated_at' | 'invalidate_reason' | 'superseded_by'
>;

export type NewMemoryEdge =
    | Omit<SupportsEdge,     'id' | 'strength' | 'status' | 'last_reinforce' | 'invalidated_at' | 'invalidate_reason'>
    | Omit<ContradictsEdge,  'id' | 'strength' | 'status' | 'last_reinforce' | 'invalidated_at' | 'invalidate_reason'>
    | Omit<RelatedToEdge,    'id' | 'strength' | 'status' | 'last_reinforce' | 'invalidated_at' | 'invalidate_reason'>
    | Omit<EvokesEdge,       'id' | 'strength' | 'status' | 'last_reinforce' | 'invalidated_at' | 'invalidate_reason'>;

// Two nodes point to the same pattern
export interface SupportsEdge extends BaseMemoryEdge {
    type: 'supports';
}

// Two nodes conflict
export interface ContradictsEdge extends BaseMemoryEdge {
    type: 'contradicts';
}

// Loose thematic/semantic link
export interface RelatedToEdge extends BaseMemoryEdge {
    type: 'related_to';
}

// Causal: this node tends to produce a reaction
export interface EvokesEdge extends BaseMemoryEdge {
    type: 'evokes';
}

export interface BaseMemoryEdge {
    id: string;
    from: string;
    to: string;
    description: string;
    strength: number;         // salience: half-life value
    status: MemoryStatus;     // active | invalidated (soft tombstone)
    last_reinforce: Date;
    invalidated_at: Date | null;
    invalidate_reason: string | null;
}

// --- Storage shapes (mirror the Ladybug tables in src/db/schema.ts) ---

// All readable/writable MemoryNode properties. Doubles as the NodeRepo
// field allowlist. `embedding` is storage-only (never on MemoryNode).
export const MEMORY_NODE_FIELDS = [
    "id",
    "type",
    "description",
    "importance",
    "validity",
    "status",
    "last_reinforce",
    "invalidated_at",
    "invalidate_reason",
    "superseded_by",
    "embedding",
] as const;

export const MemoryNodeSchema = z.object({
    id: z.string(),
    type: z.enum(["preference", "trait", "observation"]).nullable(),
    description: z.string().nullable(),
    importance: z.number().nullable(),
    validity: z.number().nullable(),
    status: z.enum(MEMORY_STATUSES).nullable(),
    last_reinforce: z.coerce.date().nullable(),
    invalidated_at: z.coerce.date().nullable(),
    invalidate_reason: z.string().nullable(),
    superseded_by: z.string().nullable(),
    embedding: z.array(z.number()).nullable(),
});

export type MemoryNodeRow = z.infer<typeof MemoryNodeSchema>;

// Upsert/patch shapes for LadybugNodeRepo<MemoryNode, ...>.
export interface MemoryNodeUpsert {
    id: string;
    type: MemoryNodeType;
    description: string;
    importance: number;
    validity: number;
    status: MemoryStatus;
    last_reinforce: Date;
    invalidated_at: Date | null;
    invalidate_reason: string | null;
    superseded_by: string | null;
    embedding: number[];
}

export type MemoryNodePatch = Partial<Omit<MemoryNodeUpsert, "id">>;

// Surfacing rank: salience scaled by believed-ness. A salient-but-disbelieved
// memory drops out of view even before it is fully invalidated.
export function memoryRank(node: MemoryNode): number {
    return node.importance * node.validity;
}

function toMemoryNode(parsed: MemoryNodeRow): MemoryNode {
    if (
        parsed.type === null ||
        parsed.description === null ||
        parsed.importance === null ||
        parsed.last_reinforce === null
    ) {
        throw new Error(`MemoryNode ${parsed.id}: missing required property`);
    }
    return {
        id: parsed.id,
        type: parsed.type,
        description: parsed.description,
        importance: parsed.importance,
        // Legacy rows may predate the validity lifecycle; default to full belief.
        validity: parsed.validity ?? 1.0,
        status: parsed.status ?? "active",
        last_reinforce: parsed.last_reinforce,
        invalidated_at: parsed.invalidated_at,
        invalidate_reason: parsed.invalidate_reason,
        superseded_by: parsed.superseded_by,
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
    e_type: z.enum(["supports", "contradicts", "related_to", "evokes"]),
    e_description: z.string(),
    e_strength: z.number(),
    e_status: z.enum(MEMORY_STATUSES).nullable(),
    e_last_reinforce: z.coerce.date(),
    e_invalidated_at: z.coerce.date().nullable(),
    e_invalidate_reason: z.string().nullable(),
});

export function mapMemoryEdge(row: GraphRow): MemoryEdge {
    const parsed = MemoryEdgeRowSchema.parse(row);
    return {
        id: parsed.e_id,
        from: parsed.from_id,
        to: parsed.to_id,
        strength: parsed.e_strength,
        status: parsed.e_status ?? "active",
        last_reinforce: parsed.e_last_reinforce,
        invalidated_at: parsed.e_invalidated_at,
        invalidate_reason: parsed.e_invalidate_reason,
        type: parsed.e_type,
        description: parsed.e_description,
    };
}
