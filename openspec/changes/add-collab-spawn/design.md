## Context

The PRD requires spawned sessions to receive join bootstrap first, with `initial_prompt` only after bootstrap injection (`notes/agent-collaboration.md` lines 604-608). Spawn instruction content may come from config or fallback templates (lines 894-910).

## Goals / Non-Goals

**Goals:**
- Implement spawn route and session creation client call.
- Apply explicit agent/model/directory overrides and safe caller-derived defaults when available.
- Queue bootstrap before initial prompt and record `spawned_sessions` ownership.

**Non-Goals:**
- No automatic spawned-session abortion on room close, as excluded by PRD line 442.
- No task-claim or readiness state.

## Decisions

- Treat spawn as a composition of create-session, member-add, and ordered prompt records so existing membership and delivery tests remain useful.
- Store the spawned session id only after OpenCode session creation succeeds.
- Render spawn instruction separately from initial prompt, allowing configured instruction to fully replace fallback.

## Risks / Trade-offs

- Caller-derived defaults may be unavailable -> Fall back to configured or OpenCode defaults and test explicit override behavior.
- Initial prompt delivery depends on bootstrap success -> Keep initial prompt pending until bootstrap is marked delivered.
