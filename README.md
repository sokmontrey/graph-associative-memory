# associative-graph-memory

A standalone extraction of the **memory graph** from `french-learning-2`, kept
here so the memory design can be experimented with on its own.

Copied verbatim (only French-learning-specific tables/files were trimmed):

- `src/db` — schema + relations for the memory graph
- `src/repos` — generic graph DB, node, and edge repositories
- `src/models` — memory node/edge models
- `src/services/embeddings` — text embedding + vector index primitives
- `src/services/graphMemory` — the memory service (half-life, search, CRUD)
- `src/services/highlevelMemory` — the high-level memory service (recall, proposeLinks,
  beliefs) + instrumentation events
- `src/mcp` — MCP server exposing the high-level API to an agent
- `src/dashboard` — HTTP + SSE server projecting the graph and every operation live
- `src/runtime` — the single-process entrypoint (MCP + dashboard)
- `dashboard/` — the React + Vite realtime UI
- `AGENT.md` — the agent guide (also served at `memory://agent-guide`)

## Memory model

Each memory has two independent axes plus a lifecycle:

- **importance** (salience) — half-life decay + reinforcement.
- **validity** (0..1, believed-ness) — decays slowly; surfacing rank = importance × validity.
- **status** — `active` or `invalidated`. Invalidation is a **soft tombstone**: kept for audit,
  excluded from every surfacing path, and reversible.

`contradicts` is no longer inert: `resolveContradiction(keep, drop, rationale)` reinforces the
winner, retires the loser, and records why. That is how an agent fights its own contradiction —
see `AGENT.md` for the full loop and test scenarios.


## Requirements

Node.js >= 24 (verified on 25.x) and npm. TypeScript runs directly via Node's
type stripping — keep to erasable syntax (no parameter properties, no enums).

```bash
npm install
npm run typecheck
```

## Database

The default database is **isolated** under the project (`data/ladybug`). Point
`LBUG_DB_PATH` at another file to use a different one:

```bash
LBUG_DB_PATH=data/ladybug node your-script.ts
```

Note: LadybugDB is embedded and single-process — don't have two processes open
the same file at once. (The original `french-learning-2` shared graph can be
opened via `LBUG_DB_PATH`, but its 1024-dim vectors are incompatible with this
project's 768-dim EmbeddingGemma embedder.)

## Usage

```ts
import { createMemoryStack } from "./src/index.ts";

const { service, close } = await createMemoryStack();
const top = await service.getTopMemories(10);
await close();
```

`createMemoryStack()` wires the graph DB, the EmbeddingGemma embedder, the
vector index, and the memory service. Inject `embedder` / `search` / `edgeRepo` /
`nodeRepo` to run without the model download.

## MCP + dashboard

The MCP server (stdio) and the realtime dashboard (HTTP/SSE) run in **one
process**, because the embedded database is single-process:

```bash
npm run serve           # MCP over stdio + dashboard at http://127.0.0.1:4317
npm run dashboard:dev   # Vite dev server with HMR, proxying the API to :4317
```

Env: `LBUG_DB_PATH`, `MEMORY_PORT` (4317), `MEMORY_MCP=0`, `MEMORY_DASHBOARD=0`,
`TYPESAFE_API_KEY` (required by `memory_propose_links`), `MEMORY_GEMMA_DTYPE`.
`.env.example` documents them; copy it to `.env` (loaded via
`node --env-file-if-exists`).

**Embedding**: EmbeddingGemma-300M (768 dims) via `@kessler/gemma-embedding`.
Its model (~300 MB) downloads once on first run, then runs offline.

Point an MCP host at `node src/runtime/start.ts`; see `AGENT.md` for host wiring,
the tool reference, and scripted test scenarios.

**OpenCode**: this repo ships `opencode.json`, so opening OpenCode in this
directory connects the memory MCP server automatically (and starts the
dashboard). The first launch downloads the EmbeddingGemma model (~300 MB) before
the server answers; run `npm run serve` once beforehand so OpenCode's tool-fetch
timeout isn't spent on the download.

Notes from the original design:

- The Ladybug `vector` extension is best-effort; when unavailable, search
  degrades to brute-force cosine automatically.
