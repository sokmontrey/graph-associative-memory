![a screenshot of the memory dashboard](/assets/readme/dashboard.png)

# Associative Graph Memory

Long-term graph memory for AI agent harnesses. One node shape, one edge
shape, free-form labels — meaning lives in the text the memory subagent
reads, not in rigid enums.

## Design

- **Node**: `content` (one self-contained statement), `kind` (free tag),
  `importance` (half-life value), `createdAt`.
- **Edge**: `from`, `to`, `relation` (free label), `description` (WHY linked —
  the subagent reads this to decide whether to hop), `strength`.
- **Reads are pure**: `search`, `recent`, `top`, `get`, `edges` (both
  directions). Reading never changes anything.
- **Writes**: `add` (server-side dedup at cosine > 0.92), `update`
  (re-embeds), `link` (upsert on `(from, to, relation)`), `forget`
  (cascades edges).
- **Reinforce is the only way values go up** (`reinforceNodes`,
  `reinforceEdges`), with saturating returns. `tick()` (batch decay) runs on
  a server-side schedule and is never exposed.
- **Call only with a reason** (see `AGENTS.md`): the main agent calls the
  `memory` subagent with MODE: RECALL only when it risks assuming
  user-specific context it doesn't have, and MODE: COMMIT only when the turn
  surfaced something durable. Skipping is the default. The low-level
  MCP tools are subagent-only; the main agent is denied them in
  `opencode.json`. No hooks, no SDK — instructions only.

## Installation

Requirements: **Node.js >= 24** (verified on 25.x) + npm. TypeScript runs via
Node type-stripping — keep to erasable syntax (no parameter properties, no
enums).

```bash
npm install
npm --prefix dashboard install
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

Open `http://127.0.0.1:4317`. The dashboard shows the graph live (size =
importance), every op with its steps/duration, a node/link inspector, and
controls to run any op without an agent. Decay needs no schedule: every 20
tool calls land one decay step automatically.

Single-process ownership: the first `start.ts` to open `MEMORY_DB_PATH`
owns the embedded DB and serves the dashboard. Any further process (second
OpenCode window, another harness) that cannot open the same file does not
crash — it probes the owner's dashboard (`MEMORY_OWNER_URL`, default
`http://127.0.0.1:MEMORY_PORT`) and serves the same MCP tools as a remote
HTTP client. Keep the owner's dashboard enabled (`MEMORY_DASHBOARD=1`) for
sharing; `MEMORY_MCP=0` / `MEMORY_DASHBOARD=0` disable either half.
`npm run explorer` launches the Ladybug explorer (Docker) on `./data`.

### 2. Use as a library

```ts
import { createMemoryStack } from "./src/index.ts";

const { service, close } = await createMemoryStack();
await service.add({ content: "Types on a mechanical keyboard", kind: "fact" });
const top = await service.top(10);
const hits = await service.search("mechanical keyboard", 5);
await close();
```

`createMemoryStack({ dbPath, embedder, search, events, nodeRepo, edgeRepo })`
wires DB + embedder + vector index + service. Inject fakes to run without
the model download.

### 3. Connect an agent (MCP host)

**OpenCode:** this repo ships `opencode.json`, so opening OpenCode here
registers the server automatically, loads `AGENTS.md` as instructions, and
registers the `memory` subagent (`.opencode/agents/memory.md`). Main agents
are denied the `associative-memory_*` tools; only `memory` may call them.

Agent loop:

1. RECALL when at risk of guessing user context: `memory` subagent searches
   (`search`/`recent`/`top`), follows `edges()` one hop, returns a BRIEFING
   (or "nothing relevant").
2. Main agent does the work; briefing is background, user wins conflicts.
3. COMMIT when the turn surfaced durable facts: subagent stores them
   (`add`/`update`/`forget`), `link`s them, and
   `reinforceNodes`/`reinforceEdges` what was used.
