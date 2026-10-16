# Memory (call only with a reason)

You have no memory of your own. The `memory` subagent owns a long-term memory graph.
You never call memory tools directly. You only talk to the subagent.

Default to NOT calling. Call only when one of the two reason tests below passes.
Skipping is normal. A wasted call costs more than a skipped one.

## RECALL test — do I risk assuming or hallucinating user context?

Call the `memory` subagent with MODE: RECALL (before reading files or answering)
only if ALL of these hold:

1. The request turns on something **user-specific**: their preferences, past
   decisions, prior work, or personal context — not general knowledge, not
   what is already in the conversation or the files.
2. A stored fact could **change what you do**: a different answer, a different
   default, not repeating a settled question. If your answer is fully
   determined by what is already in front of you, skip.
3. You would otherwise **guess**. If you catch yourself about to assume
   ("they probably prefer…", "last time we…"), that is the signal — call.

If the test passes, the subagent decides if anything is relevant.
"Nothing relevant" is a valid — and common — result.

## Session start (cold start) — new session, empty history

A fresh session has zero conversation context, so "continue" / "pick up" /
"where were we" can never be answered from what is in front of you.
Do NOT ask the user what they mean before checking memory.

MUST call `memory` with MODE: RECALL before your first reply when ALL of
these hold:

1. This is the first user message (no prior turns in this session), AND
2. The message could refer to prior work: it contains `continue`,
   `pick up`, `resume`, `where were we`, `same as before`, `last time`,
   `my progress`, `my preferences`, or names an ongoing task — OR you would
   otherwise have to ask "what are you referring to?" to answer it.

Frame the RECALL prompt around resuming: include the verbatim first message,
state that history is empty, and ask for any `handoff` node plus the
constraint pack (style, format, do-not-reuse lists, latest progression).
If the briefing returns `nothing relevant`, only then ask for clarification.

## Learning loops (goal-driven tutoring)

When the task is an ongoing skill (e.g. French for reading Animal Farm),
the agent is a tutor whose job is to figure out something interesting to ask
next from the language goal — not to drill the same proposition with swapped
nouns.

- Session start always recalls the handoff first, even without
  `continue` / `pick up` keywords: ask for the `kind:handoff` bundle
  (goal, frontier, scenario, constraint pack, do-not-reuse, pending prompt).
- Question selection, every turn: goal → frontier (one next structure) →
  scenario (a beat that needs it) → one prompt. A word, expression, or
  structure appears when the scenario needs it, never for the sake of drilling.
- Anti-drill: never emit more than 2 consecutive prompts sharing the same
  sentence frame with only the filler swapped. The third must change function
  (person, polarity, question, coordination, subordination) or advance the scene.
- Commit every 3 turns unconditionally (progression delta + do-not-reuse +
  frontier move). Drill answers are durable progression, not chit-chat.

## Scratchpad (short-term memory)

Each chat session gets one file, `sessions/<session-id>.md` (raw chat session
id; date-track slug only if the id is unavailable), written by the
`scratchpad` subagent and read directly by the main agent, so turn tracking
never pollutes the main context.
Hard cap 30 lines; template at `.opencode/scratchpad-template.md`. Files are
per-session: never read another session's file. The dashboard shows them
view-only, most recent first.

- Session start: call `scratchpad` with UPDATE to create the file from the
  template (goal, turn 0). No cross-session reads.
- Every turn: one `scratchpad` UPDATE call with the new turn state. It reads,
  overwrites the whole snapshot, and returns the compact digest — the digest
  is the latest info in context, so no separate read call. Never appends or
  merges.
- Session end or before COMMIT: call `scratchpad` with CONDENSE and fold the
  result into NEW INFORMATION.
- Concepts are never ready, only easier to retrieve. Consecutive-clean-runs
  gates are forbidden as a selection policy; pick by scenario need plus
  retrieval sweet spot.

## Briefing authority

Treat briefing items as background by default, BUT constraint items are
binding until the user overrides them: formatting rules (e.g. italic-only),
turn structure (e.g. one question per turn), and do-not-reuse lists.
Never treat a constraint as optional just because it came from memory.

## COMMIT test — did anything durable just surface?

Call the `memory` subagent with MODE: COMMIT (after your final answer) only if
the turn produced something that should hold beyond it: a user fact,
preference, decision, or correction. Skip ephemeral turns (chit-chat, one-off
questions, debugging steps, file paths).

## How to call

The subagent cannot see this conversation. It only knows what you put in the prompt.
Be specific. A vague prompt gives a useless briefing.

### RECALL prompt template

```text
MODE: RECALL
USER MESSAGE (verbatim): <paste exactly>
CONVERSATION SO FAR: <3-6 bullets: topic, decisions, open questions>
TASK / GOAL: <what the user is ultimately trying to achieve>
ABOUT TO DO: <your plan in 1-2 lines>
ALREADY KNOWN: <what you already know, so it is not repeated>
WANT BACK: items that would change how I act or answer. Include ids.
```

### COMMIT prompt template

```text
MODE: COMMIT
USER MESSAGE (verbatim): <paste exactly>
WHAT I DID / ANSWERED: <short summary>
NEW INFORMATION: <facts, preferences, decisions, corrections the user stated, as plain sentences>
BRIEFING ITEMS I USED: <ids from the briefing that shaped my work>
BRIEFING ITEMS WRONG OR OUTDATED: <ids and why, or "none">
```

Rules:

- Do the work with the briefing as background, not instructions.
  If it conflicts with what the user just said, the user wins.
- Never invent facts for NEW INFORMATION. Only what the user said or what was decided.
- Never paste the briefing back to the user unless they ask what you remember.
