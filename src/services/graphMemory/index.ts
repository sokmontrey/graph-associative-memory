import type { MemoryEdge, MemoryNode, NewMemoryEdge, NewMemoryNode } from "../../models/memory.ts";

export interface MemoryService {
    // Returns top-n nodes sorted by importance
    getTopMemories(n: number): Promise<MemoryNode[]>;

    // Returns top-n edges of a node, optionally filtered by type, sorted by strength
    getMemoryTopEdges(memoryId: string, type: MemoryEdge['type'] | null, n: number): Promise<MemoryEdge[]>;

    // Semantic search on nodes sorted by importance — pure read, no reinforce
    findMemories(keyword: string, n: number): Promise<MemoryNode[]>;

    // Semantic search on edges of a node sorted by strength — pure read, no reinforce
    findMemoryEdges(memoryId: string, keyword: string, n: number): Promise<MemoryEdge[]>;

    // Traverse to neighbors via selected edges — pure read, no reinforce
    getMemoryNeighbors(memoryId: string, edgeIds: string[]): Promise<MemoryNode[]>;

    // Explicit reinforce: bump importance of the given nodes, refresh last_reinforce.
    // Returns the updated nodes (skips unknown ids).
    reinforceMemories(memoryIds: string[], strength?: number): Promise<MemoryNode[]>;

    // Explicit reinforce: bump strength of the given out-edges of memoryId,
    // refresh last_reinforce. Returns the updated edges (skips unknown ids).
    reinforceMemoryEdges(memoryId: string, edgeIds: string[], strength?: number): Promise<MemoryEdge[]>;

    // Soft-tombstone a memory: status -> invalidated, validity -> 0, records the
    // reason/time (+ optional superseding memory). Kept for audit, excluded from
    // every surfacing path, reversible via reinstateMemory.
    invalidateMemory(memoryId: string, reason: string, supersededBy?: string | null): Promise<MemoryNode>;

    // Soft-tombstone an edge by id. Returns null when the edge is unknown.
    invalidateMemoryEdge(edgeId: string, reason: string): Promise<MemoryEdge | null>;

    // Undo invalidation: status -> active, clears invalidation fields, resets
    // validity (defaults to full). Returns null when the memory is unknown.
    reinstateMemory(memoryId: string, validity?: number): Promise<MemoryNode | null>;

    // Undo edge invalidation by id. Returns null when the edge is unknown.
    reinstateMemoryEdge(edgeId: string): Promise<MemoryEdge | null>;

    // Set the believed-ness value directly (clamped to 0..1 by the caller).
    setMemoryValidity(memoryId: string, validity: number): Promise<MemoryNode | null>;

    addMemory(node: NewMemoryNode): Promise<MemoryNode>;
    addEdge(edge: NewMemoryEdge): Promise<MemoryEdge>;

    // Batch half-life update: applies decay to active nodes (importance and
    // validity) and active edges (strength). Invalidated rows are frozen.
    // Reinforce happens only via the explicit reinforce* methods above.
    tick(): Promise<void>;
}
