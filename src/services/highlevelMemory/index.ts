import type { MemoryEdge, MemoryNode, MemoryNodeType } from "../../models/memory.ts";

export interface HighlevelMemoryService {
    // Top N memories by surfacing rank (importance x validity). With
    // `semanticQuery`, candidates come from semantic search first, then get
    // ranked.
    getTopImportance(
        type: MemoryTypeFilter,
        n: number,
        semanticQuery?: string
    ): Promise<MemoryNode[]>;

    // Associative recall: anchor on `initialIdea`, explore toward `goalIdea`,
    // `searchHints` bridging the gap faster. Not a pure read — it strengthens
    // the edges on the explored path.
    recall(initialIdea: string, goalIdea: string, searchHints?: string[]): Promise<RecallResult>;

    // Store a new memory with the links you already understand (cf. proposeLinks).
    remember(
        type: MemoryNodeType,
        description: string,
        links: RememberLink[]
    ): Promise<{ node: MemoryNode; edges: MemoryEdge[] }>;

    // Propose links for the active buffer (recently remembered + last-recalled
    // memories), or around a single `focusId` (the focus plus its semantic
    // neighbors — independent of the buffer). Relation type and direction come
    // from a grounded model; you supply the `description` only when you connect.
    proposeLinks(options?: ProposeLinksOptions): Promise<LinkProposal[]>;

    // Commit a link you can justify. Stored `from -> to`.
    connect(link: MemoryLink): Promise<MemoryEdge>;

    // --- Belief maintenance: the truth axis, orthogonal to decay ------------

    // Decisively retire a memory or connection: soft tombstone (kept for audit,
    // excluded from every surfacing path, reversible via `reinstate`).
    invalidate(
        target: InvalidationTarget,
        reason: string,
        supersededBy?: string
    ): Promise<InvalidationResult>;

    // Undo an invalidation, restoring the target to active.
    reinstate(target: InvalidationTarget, reason?: string): Promise<InvalidationResult>;

    // Adjudicate a contradiction you can judge: reinforce `keepId`, retire
    // `dropId` (superseded_by = keepId), and record the rationale on a
    // `contradicts` edge. This is how an agent fights its own contradiction.
    resolveContradiction(
        keepId: string,
        dropId: string,
        rationale: string,
        evidence?: Record<string, number>
    ): Promise<ContradictionResolution>;

    // Soft doubt: lower validity (no status change). For evidence that casts
    // doubt without settling the question.
    challenge(memoryId: string, reason: string): Promise<MemoryNode>;

    // Soft support: raise validity toward 1 and reinforce salience.
    corroborate(memoryId: string, reason?: string): Promise<MemoryNode>;

    // Explicit salience bump (importance), refreshing last_reinforce.
    reinforce(memoryId: string, strength?: number): Promise<MemoryNode>;

    // Read one memory with its incident edges and neighbors (for inspection).
    inspect(memoryId: string): Promise<MemoryInspection>;

    // Whole-graph counts and averages (incl. active vs invalidated).
    stats(): Promise<MemoryStats>;

    // Direct validity write (clamped to 0..1), for a caller that computed it.
    setValidity(memoryId: string, validity: number): Promise<MemoryNode>;
}

// "all" = no type filter.
export type MemoryTypeFilter = MemoryNodeType | "all";

export interface ProposeLinksOptions {
    focusId?: string;
    limit?: number;
}

// Link to a brand-new memory; `direction` says which side the new node is on.
export interface RememberLink {
    otherNodeId: string;
    direction: "out" | "in";
    edgeType: MemoryEdge["type"];
    description: string;
}

// Link between two memories that already exist.
export interface MemoryLink {
    fromId: string;
    toId: string;
    edgeType: MemoryEdge["type"];
    description: string;
}

// `link` is the `connect` args minus `description`, so a proposal feeds
// `connect` directly; drop the ones you can't justify.
export interface LinkProposal {
    link: Omit<MemoryLink, "description">;
    confidence: number;
    // Grounding Noul probabilities, e.g. same_referent / conflict / direction.
    evidence: Record<string, number>;
    // Full nodes (not just ids) so the why can be written without refetching.
    nodes: { from: MemoryNode; to: MemoryNode };
    // Present when the proposed relation is `contradicts`: which side the
    // grounded model thinks the evidence favors (feed into resolveContradiction).
    contradiction?: { favoredId: string; confidence: number };
}

// `path` is the single best chain while `goals` may be several — one chain
// cannot reach them all yet.
export interface RecallResult {
    anchors: MemoryNode[];
    path: RecallStep[];
    goals: MemoryNode[];
}

export interface RecallStep {
    fromId: string;
    edge: MemoryEdge;
    to: MemoryNode;
}

// A memory or connection, addressed by id.
export type InvalidationTarget = { nodeId: string } | { edgeId: string };

export interface InvalidationResult {
    kind: "node" | "edge";
    node?: MemoryNode;
    edge?: MemoryEdge;
}

export interface ContradictionResolution {
    kept: MemoryNode;      // reinforced winner
    dropped: MemoryNode;   // invalidated loser
    edge: MemoryEdge;      // contradicts edge carrying the rationale
}

export interface MemoryInspection {
    node: MemoryNode | null;
    outEdges: MemoryEdge[];
    inEdges: MemoryEdge[];
    neighbors: MemoryNode[];
}

export interface MemoryStats {
    nodes: {
        total: number;
        active: number;
        invalidated: number;
        avgImportance: number;
        avgValidity: number;
    };
    edges: {
        total: number;
        active: number;
        invalidated: number;
        avgStrength: number;
    };
    byNodeType: Record<MemoryNodeType, number>;
    byEdgeType: Record<MemoryEdge["type"], number>;
}

export type { HighlevelMemoryServiceDeps } from "./highlevelMemoryService.ts";
export type { GroundedLink, LinkGrounder } from "./linkGrounder.ts";
export { JevLinkGrounder, type JevLinkGrounderOptions } from "./jevLinkGrounder.ts";
export {
  createMemoryEventBus,
  NOOP_MEMORY_EVENTS,
  type MemoryEvent,
  type MemoryEventBus,
  type MemoryOpKind,
} from "./events.ts";
