# Agent guide — associative graph memory

You have an MCP server exposing an **associative memory graph**. This guide is the mental
model, the tool reference, and scripted test scenarios. It is also served over MCP at
`memory://agent-guide`, and the server's `instructions` summarise it.

## The two axes of a memory

Every memory has two independent numbers, plus a lifecycle:

- **importance** — *salience*: how readily it surfaces. Decays a little on every
  operation (each op advances a shared decay clock with its own slow rate; rows
  settle their backlog lazily when read), rises when you reinforce it (e.g. it
  was recalled or proved useful). The dashboard `tick` button applies one large
  bulk decay step.
- **validity** — *believed-ness* (0..1). Decays slowly. Multiplies into surfacing rank.
- **status** — `active` or `invalidated`. An invalidated memory is a **soft tombstone**:
  kept for audit, excluded from every surfacing path, reversible.

**Surfacing rank = importance × validity.** A salient-but-disbelieved memory drops out of view
before you even invalidate it. Invalidated memories never surface.

Why two axes: decay alone only *erodes* salience — slowly, uniformly, and never decisively.
It cannot express "I now know this is wrong." Validity + invalidation is that decisive truth
axis, and it is what lets you **fight your own contradictions**.

## The tools

Reads:

- **`memory_get_top_importance`** `{ type, n, semanticQuery? }` — the most important memories
  (`rank` order). Use it to surface what you currently believe before answering. `type` is
  `preference | trait | observation | all`; pass `semanticQuery` to bias by topic.
- **`memory_recall`** `{ initialIdea, goalIdea, searchHints? }` — walks the graph from one idea
  toward another, **strengthening the edges on the path** (not a pure read). Returns
  `{ anchors, goals, path }`. Use it to reconstruct *how two ideas connect*.
- **`memory_stats`** `{}` — whole-graph counts/averages (incl. active vs invalidated).
- **`memory_get_node`** `{ id }` — one memory with its incident edges and neighbors.

Writes:

- **`memory_remember`** `{ type, description, links[] }` — store a new memory plus the links
  you already understand (`direction: "out"` puts the new node on the from side). Then call
  `memory_propose_links` to find the rest.
- **`memory_propose_links`** `{ focusId?, limit? }` — ask the grounded model for candidate
  links. With `focusId`, the memory is evaluated against its semantic neighbors (works even on
  a fresh server). Without it, it uses the active buffer (recent remembers + last recall). Each
  proposal carries the relation, direction, confidence, evidence, and — for a contradiction — a
  `contradiction.favoredId`.
- **`memory_connect`** `{ fromId, toId, edgeType, description }` — commit a link you can
  justify (usually a proposal + a `description` you write). Stored `from -> to`.
- **`memory_reinforce`** `{ memoryId, strength? }` — raise salience.
- **`memory_challenge`** `{ memoryId, reason }` — *soft doubt*: lower validity, keep it active.
- **`memory_corroborate`** `{ memoryId, reason? }` — *support*: raise validity + reinforce.
- **`memory_invalidate`** `{ nodeId | edgeId, reason, supersededBy? }` — *decisive*: retire a
  memory or connection (soft tombstone).
- **`memory_reinstate`** `{ nodeId | edgeId, reason? }` — undo an invalidation.
- **`memory_resolve_contradiction`** `{ keepId, dropId, rationale, evidence? }` — reinforce the
  winner, retire the loser (`superseded_by = keepId`), and record the rationale on a
  `contradicts` edge.

All tool results are JSON text.

## Mindful use (never forget, never overuse)

Session loop — start once, middle only when needed, end only for durable facts:

1. **START (once per task).** `memory_stats` only if graph size matters, then
   `memory_get_top_importance` **once** with `n <= 10` (stored preference: keep
   `n` small). Prefer `semanticQuery` to narrow by topic over a large `n`.
   Do NOT poll top every turn.
2. **MIDDLE (only to explain a connection).** `memory_recall` only to
   reconstruct *how two ideas connect* before explaining it — it strengthens
   edges, so it is NOT a pure read and NOT a lookup. Budget 1–2 recalls per
   question; add `searchHints` if the path is empty instead of retrying.
   For lookup, use `memory_get_top_importance` + `semanticQuery`.
3. **END (only for durable facts).** `memory_remember` in **one batch** at task
   end: preferences, traits, long-lived observations only — never ephemeral
   chat. Stored preferences, now enforced by the tool descriptions:
   - **Atomic memories**: one fact per memory, break stories into small linked
     pieces, not single composites. Check `semanticQuery` first to avoid
     duplicates.
   - **Propose once**: after the batch, run `memory_propose_links` **once**
     (prefer `focusId`; if propose fails or returns nothing usable, connect
     manually). Connect only links you can justify; drop the rest. Never
     re-propose in a loop.
4. **BELIEF (only on evidence).** `memory_reinforce` / `memory_corroborate`
   only after a memory proves useful or independent evidence agrees — never
   speculatively. `memory_challenge` for soft doubt, `memory_invalidate` only
   when you know it is wrong, `memory_resolve_contradiction` only for a
   decided head-to-head (see contradiction loop). `memory_get_node` only to
   inspect a shortlisted id, never to scan the graph.

Anti-patterns: top-every-turn, recall-as-search, remember-everything,
propose-until-something-sticks, reinforce/corroborate loops.

## The contradiction loop (the important workflow)

1. **Detect.** Either `memory_propose_links` returns a proposal with `edgeType: "contradicts"`
   (and a `contradiction.favoredId`), or a `memory_recall` path traverses a `contradicts` edge.
2. **Weigh.** Read the proposal `evidence` (`conflict`, `same_referent`, `favored`, relation
   probabilities) and the two memories' descriptions. The model suggests; **you decide**.
3. **Adjudicate.** Call `memory_resolve_contradiction(keepId, dropId, rationale)`. The winner
   is reinforced (more salient) and corroborated (more believed); the loser is retired with a
   reason and `superseded_by`.
4. **Or hedge.** When evidence is ambiguous, use `memory_challenge` (soft doubt — lower
   validity, still active) instead of a decisive kill.
5. **Undo if wrong.** `memory_reinstate` restores a tombstone; validity resets to full.

## Scripted test scenarios

Each scenario builds its own data from an empty graph (there is no seed corpus).

### A. Baseline: remember → recall → propose → connect

1. `memory_stats` — note the counts (zero on a fresh database).
2. `memory_remember { type: "observation", description: "Types on a mechanical keyboard" }` — note its id.
3. `memory_remember { type: "trait", description: "Does most focused work late at night" }`, linking
   to the first: `links: [{ otherNodeId: <kb id>, direction: "out", edgeType: "related_to", description: "used in late-night sessions" }]`.
4. `memory_recall { initialIdea: "mechanical keyboard", goalIdea: "late-night work" }` — expect a
   path along that edge; the traversed edge is reinforced.
5. `memory_propose_links { focusId: <kb id> }` — read the proposals and evidence.
6. `memory_connect` a proposal you agree with, writing your own `description`.

Expected on the dashboard: a new node appears, the recall path lights up, proposals render as
dashed pairs.

### B. Contradiction resolution

1. `memory_remember { type: "observation", description: "Dislikes coffee and avoids caffeine" }` — note id A.
2. `memory_remember { type: "observation", description: "Drinks an espresso every morning" }` — note id B.
3. `memory_propose_links { focusId: <A> }` — expect a `contradicts` proposal with
   `contradiction.favoredId` (needs `TYPESAFE_API_KEY`).
4. `memory_resolve_contradiction { keepId: <favored>, dropId: <the other>, rationale: "..." }`.
5. `memory_get_node { id: <loser> }` — expect `status: "invalidated"`, `validity: 0`,
   `supersededBy: <winner>`.
6. `memory_get_top_importance { type: "all", n: 20 }` — the loser is gone; the winner's rank rose.
7. `memory_reinstate { nodeId: <loser> }` — it comes back; prove the tombstone is reversible.

Expected on the dashboard: the loser greys out (dashed tombstone) and drops from the graph when
"show invalidated" is off; the resolution op lists `reinforce → validity → invalidated → linked`.

### C. Soft doubt

1. `memory_challenge { memoryId: <id>, reason: "the source was unreliable" }` — validity halves,
   rank drops, still active.
2. `memory_get_top_importance` — the memory's rank fell.
3. `memory_corroborate { memoryId: <id> }` — validity rises again.

## Running it

```bash
npm install
npm run serve     # MCP over stdio + dashboard at http://127.0.0.1:4317
```

Env: `MEMORY_DB_PATH` (default `./data/ladybug`, isolated; `LBUG_DB_PATH`
still honoured as a legacy fallback), `MEMORY_PORT` (default 4317),
`MEMORY_MCP=0` / `MEMORY_DASHBOARD=0`, `TYPESAFE_API_KEY` (required by `memory_propose_links`,
which calls the TypeSafe/Jev grounded model), and `MEMORY_GEMMA_DTYPE` (embedder quantization).
The embedder is EmbeddingGemma-300M (768 dims); its ~300 MB model downloads once on first run,
then everything runs offline.

**One process owns the database** (Ladybug is embedded, single-process). The first
`src/runtime/start.ts` to open it serves MCP + dashboard together; any further
process (second OpenCode window, another harness) that cannot open the same file
does not crash — it probes the owner's dashboard (`MEMORY_OWNER_URL`, default
`http://127.0.0.1:MEMORY_PORT`) and serves the same MCP tools as a remote HTTP
client. Keep the owner's dashboard enabled for sharing.

Entries: `src/runtime/start.ts` is the process entry (MCP stdio + dashboard),
`src/stack.ts` is the wiring entry (`createMemoryStack`), `src/index.ts` is the
thin public library entry (re-exports only), `src/db/index.ts` resolves the
isolated DB path.

### Host wiring (stdio)

```json
{
  "mcpServers": {
    "associative-memory": {
      "command": "node",
      "args": ["/absolute/path/to/associative-graph-memory/src/runtime/start.ts"],
      "env": { "TYPESAFE_API_KEY": "..." }
    }
  }
}
```

**OpenCode**: the repo ships `opencode.json` (project config), so opening OpenCode in this
directory registers the server automatically and loads this guide as instructions:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "associative-memory": {
      "type": "local",
      "command": ["node", "--env-file-if-exists=.env", "src/runtime/start.ts"],
      "cwd": ".",
      "enabled": true,
      "timeout": 300000,
      "environment": { "TYPESAFE_API_KEY": "{env:TYPESAFE_API_KEY}" }
    }
  },
  "instructions": ["AGENT.md"]
}
```

The first launch downloads the EmbeddingGemma model (~300 MB) before the server answers
`initialize`; run `npm run serve` once beforehand so OpenCode's tool-fetch timeout isn't spent
on the download.

## Dashboard

Open `http://127.0.0.1:4317` (or `npm run dashboard:dev` for the Vite dev server with HMR,
proxying the API to `:4317`). It shows the whole graph live and projects every step of every
operation as it happens:

- **Graph**: node colour = type, size = importance, opacity = validity, dashed grey = invalidated.
  Recall paths animate, proposals render as dashed pairs, the favored side of a contradiction is
  ringed.
- **Operations**: each op with its steps (search/rank, recall hop chain, grounding evidence,
  invalidation reason, resolution rationale) and duration.
- **Inspector**: full detail for a clicked node/link, including `status`, `validity`,
  `invalidateReason`, `supersededBy`.
- **Controls**: run any operation from the UI (including the belief ops and `tick`), so you can
  test without an agent.

## Notes

- The dashboard's wire types are duplicated in `dashboard/src/types.ts`; keep them in sync with
  `src/dashboard/protocol.ts` and `src/services/highlevelMemory/events.ts`.
