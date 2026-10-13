# Associative Graph Memory

An experimental long-term associative memory system for AI agent harnesses. This was built as part of the French learning system project, which needed a dynamic learner preference/progression tracking system. 

## The core idea

- Every memory node has a half-life value that decays over time, indicating how important it is compared to others.
- High-importance nodes show up regularly in the top query results.
- Agents are restricted to tools that allow them to only query the immediate nodes that "come to mind".
- If the agent needs to find any specific details, it will have to do graph walking, which strengthens the edges between nodes.
- These stronger edges will also show up more regularly than the rest when the agent reads the edges of a node.

## Limitations

This is an effortful memory system.
Agents need to intentionally look for "what's missing", which is a very difficult task at the moment.
It has to know what it doesn't know. And oftentimes, it never performs this well.

> [!NOTE]
> Due to this limitation, users will have to guide and instruct the agent to use the memory.

## Next step

A system1 model (Jev by Typesafe) is currently used to propose links between memories as an attempt to reduce the need for the agent to think. But a thin gap identification layer for the agent that automatically searches, consolidates, and injects context directly to the agent should be explored. Before this can become a system1 memory system on its own.

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
            "args": [
                "/absolute/path/to/associative-graph-memory/src/runtime/start.ts"
            ],
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
