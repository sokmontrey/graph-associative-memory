# associative-graph-memory

Long-term memory for AI agents. Save what the agent learns, surface what's
relevant now, and correct what's wrong — outdated ideas fade, contradictions
get resolved, nothing is silently lost.

Connects over MCP tools plus a live dashboard: the agent remembers, links,
and recalls; you watch the graph update in realtime.

## Features

- **Everything has a half-life.** Nodes carry `importance`, edges carry
  `strength`. Both fade over time.
- **Important nodes surface.** High-importance memories show up regularly in
  top results.
- **Strong edges connect.** Well-used paths make graph walks reach their goal
  faster and better.
- **Use makes strong.** Reading a node or walking an edge reinforces it — the
  more it's used, the longer it lives.
- **Recall beats lookup.** Instead of fetching a node directly, the agent
  walks from a start idea to a goal idea (`recall`). The walked edges and the
  used goal node grow stronger, so knowledge is found by association. This
  avoids the rich-get-richer trap, where the already-strongest nodes would
  otherwise win every time and the rest never gets visited.
- **Forgetting is automatic.** A lazy global decay clock quietly fades unused
  nodes and edges; the dashboard `tick` button applies one big forgetting
  step.
- **Second opinions included.** `propose_links` uses Jev to suggest how two
  memories relate and which side to keep on conflict (you decide), and a
  separate belief score (`validity`) lets the agent doubt or correct a memory
  without deleting it.
- **Comprehensive dashboard.** Live graph, every operation step-by-step,
  node/link inspector, controls to run any op, and semantic search — watch
  memory strengthen, fade, and rewire in realtime.

## Installation

Requirements: **Node.js >= 24** (verified on 25.x) + npm. TypeScript runs via
Node type-stripping — keep to erasable syntax (no parameter properties, no
enums).

```bash
npm install
npm --prefix dashboard install
cp .env.example .env   # then set TYPESAFE_API_KEY (see Env)
npm run typecheck
```

First run downloads the EmbeddingGemma model (~300 MB) into `./local_cache`,
then runs offline. Run `npm run serve` once beforehand so MCP host timeouts
aren't spent on the download.

## Usage

### 1. Serve MCP + dashboard (primary)

```bash
npm run serve           # MCP over stdio + dashboard at http://127.0.0.1:4317
npm run dashboard:dev   # Vite dev server with HMR, proxying API to :4317
```

Open `http://127.0.0.1:4317`. The dashboard shows the graph live (colour =
type, size = importance, opacity = validity, dashed grey = invalidated),
every op with its steps/duration, a node/link inspector, and controls to run
any op (including belief ops and `tick`) without an agent.

Single-process rule: don't run two processes against the same `LBUG_DB_PATH`.
`MEMORY_MCP=0` / `MEMORY_DASHBOARD=0` disable either half.
`npm run explorer` launches the Ladybug explorer (Docker) on `./data`.

### 2. Use as a library

```ts
import { createMemoryStack } from "./src/index.ts";

const { service, highlevel, close } = await createMemoryStack();
await highlevel.remember("observation", "Types on a mechanical keyboard", []);
const top = await highlevel.getTopImportance("all", 10);
const path = await highlevel.recall("mechanical keyboard", "late-night work");
await close();
```

`createMemoryStack({ dbPath, embedder, search, grounder, events, nodeRepo, edgeRepo })`
wires DB + embedder + vector index + services. Inject fakes to run without
the model download.

### 3. Connect an agent (MCP host)

Generic stdio wiring:

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

**OpenCode:** this repo ships `opencode.json`, so opening OpenCode here
registers the server automatically and loads `AGENT.md` as instructions.

Agent loop (see `AGENT.md` + `memory://agent-guide`):

1. `memory_get_top_importance` before answering (what do I believe?).
2. `memory_remember` + `memory_propose_links` → `memory_connect`.
3. `memory_recall` to explain how two ideas connect.
4. On conflict: `memory_resolve_contradiction(keepId, dropId, rationale)`;
   on doubt: `memory_challenge`; on support: `memory_corroborate`.
5. `memory_invalidate` to retire, `memory_reinstate` to undo.

## Env

`.env.example` documents all vars (loaded via `node --env-file-if-exists=.env`):

- `LBUG_DB_PATH` — default `./data/ladybug` (isolated). Point elsewhere to
  share (additive migration adds validity/decay columns with defaults).
- `MEMORY_PORT` — default `4317`.
- `MEMORY_MCP` / `MEMORY_DASHBOARD` — set to `0` to disable either half.
- `MEMORY_GEMMA_DTYPE` — `q8` (default, ~300 MB), `fp32`, or `q4`.
- `TYPESAFE_API_KEY` — powers `memory_propose_links` suggestions (Jev).
  Missing key warns once at startup instead of failing late.

## Project layout

- `src/db` — schema + relations (incl. `MemoryDecayClock`, watermarks)
- `src/repos` — generic graph/node/edge repos (Ladybug)
- `src/models` — memory node/edge types + rank
- `src/services/embeddings` — Gemma embedder + vector index
- `src/services/graphMemory` — low-level service + `decay/` (clock, math,
  settler) + `search/`
- `src/services/highlevelMemory` — recall, proposeLinks, beliefs,
  instrumentation events
- `src/mcp` — MCP server (tools, guide resource, prompt)
- `src/dashboard` — HTTP + SSE server projecting graph + ops
- `src/runtime` — single-process entrypoint (`start.ts`)
- `dashboard/` — React + Vite realtime UI
- `AGENT.md` — agent mental model, tool reference, test scenarios A/B/C

Wire types are duplicated in `dashboard/src/types.ts`; keep in sync with
`src/dashboard/protocol.ts` and `src/services/highlevelMemory/events.ts`.
