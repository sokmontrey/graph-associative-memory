// Simplest general graph: ONE node shape, ONE edge shape, free-form labels.
// Meaning lives in `content`, `relation`, and `description`, not in rigid enums.
// The memory subagent (an LLM) reads those, so labels can evolve without migrations.

export interface MemoryNode {
    id: string;
    content: string;            // one self-contained statement, readable without context
    kind: string;               // free tag: "preference" | "fact" | "event" | "decision" | ...
    importance: number;         // half-life value: decays on tick(), bumped by reinforce
    createdAt: Date;            // enables "latest first" recall
    lastReinforcedAt: Date;
    // embedding is storage-only, never returned
}

export interface MemoryEdge {
    id: string;
    from: string;
    to: string;
    relation: string;           // free label: "supports" | "contradicts" | "related_to" | "evokes" | "updates" | ...
    description: string;        // WHY these are linked. The subagent reads this to decide whether to hop.
    strength: number;           // half-life value
    createdAt: Date;
    lastReinforcedAt: Date;
}

// Low-level tools exposed ONLY to the memory subagent (e.g. via MCP).
// The main agent never sees these.
export interface MemoryTools {
    // ---- READ: pure, no side effects ----
    search(query: string, n?: number, kind?: string): Promise<MemoryNode[]>;     // semantic, ranked by relevance x importance
    recent(n?: number, kind?: string): Promise<MemoryNode[]>;     // createdAt desc
    top(n?: number): Promise<MemoryNode[]>;                       // importance desc
    get(ids: string[]): Promise<MemoryNode[]>;
    // Edges touching a node, BOTH directions, strength desc. Optional filter by relation or semantic query.
    edges(nodeId: string, opts?: { relation?: string; query?: string; n?: number }): Promise<MemoryEdge[]>;

    // ---- WRITE ----
    // Server-side dedup: if a near-duplicate exists (cosine > ~0.92) return it and reinforce it instead.
    add(input: { content: string; kind: string }): Promise<MemoryNode>;
    update(id: string, patch: { content?: string; kind?: string }): Promise<MemoryNode>;  // re-embeds
    // Upsert: if the same (from, to, relation) exists, reinforce it instead of duplicating.
    link(input: { from: string; to: string; relation: string; description: string }): Promise<MemoryEdge>;
    forget(ids: string[]): Promise<void>;                         // wrong or obsolete nodes (cascades edges)

    // ---- REINFORCE: the ONLY way importance/strength go up ----
    reinforceNodes(ids: string[], amount?: number): Promise<void>;
    reinforceEdges(ids: string[], amount?: number): Promise<void>;
}

// NOT exposed to any agent:
//   tick(): batch half-life decay on all nodes and edges. No schedule, no
//   cron: every OPS_PER_TICK operations land one tick inside the service.
//
// Server-side rules worth enforcing so the subagent cannot go wrong:
//   - reinforce saturates (diminishing returns) to avoid rich-get-richer
//   - search filters by a relevance threshold first, then ranks by relevance * importance^alpha
//   - hard cap on add() calls per subagent run (e.g. 5)

// --- Server-side policy (enforced by the service, not the subagent) ---

export const MEMORY_POLICY = {
    /** Cosine above this means "already stored": return + reinforce instead of adding. */
    DEDUP_COSINE_THRESHOLD: 0.92,
    /** Max add() calls per sliding window (circuit breaker for runaway loops, not a throttle). */
    MAX_ADDS_PER_WINDOW: 25,
    ADD_WINDOW_MS: 60_000,
    /** Relevance floor: hits below this are dropped before ranking. */
    RELEVANCE_THRESHOLD: 0.3,
    /** Ranking: relevance * importance^alpha. */
    IMPORTANCE_ALPHA: 0.5,
    /** Default reinforce bump (saturating toward MAX_VALUE). */
    DEFAULT_REINFORCE_AMOUNT: 0.1,
    MAX_VALUE: 1.0,
    INITIAL_IMPORTANCE: 1.0,
    INITIAL_STRENGTH: 1.0,
    /** Per-tick multiplicative decay (a tick lands every OPS_PER_TICK ops). */
    TICK_NODE_FACTOR: 0.98,
    TICK_EDGE_FACTOR: 0.98,
    /** Every operation counts toward decay: a tick lands every N ops. */
    OPS_PER_TICK: 20,
    /** Kinds exempt from tick decay: goal bundles and standing constraints
     * must not fade while in active use. The service skips them in applyDecay. */
    PINNED_KINDS: ["handoff", "constraint"],
} as const;

/** Saturating reinforce: diminishing returns toward MAX_VALUE. */
export function saturatingReinforce(current: number, amount: number): number {
    if (!Number.isFinite(current) || !Number.isFinite(amount) || amount < 0) {
        throw new Error(`saturatingReinforce: bad input current=${current} amount=${amount}`);
    }
    return Math.min(MEMORY_POLICY.MAX_VALUE, current + amount * (MEMORY_POLICY.MAX_VALUE - current));
}
