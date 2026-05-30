## Context

The PRD requires spawned sessions to receive join bootstrap first, with `initial_prompt` only after bootstrap injection (`notes/agent-collaboration.md` lines 604-608). Spawn instruction content may come from config or fallback templates (lines 894-910).

## Goals / Non-Goals

**Goals:**
- Implement spawn route and session creation client call.
- Apply explicit agent/model/directory overrides and safe caller-derived defaults when available.
- Queue bootstrap before initial prompt and record `spawned_sessions` ownership.
- Validate planner status and alias uniqueness before calling OpenCode session creation (avoid wasted API calls).
- Store model variant alongside provider and model IDs for complete spawn prompt passthrough.

**Non-Goals:**
- No automatic spawned-session abortion on room close, as excluded by PRD line 442.
- No task-claim or readiness state.

## Decisions

- Treat spawn as a composition of validate, create-session, member-add, and ordered prompt records so existing membership and delivery tests remain useful.
- Validate planner status and alias collision before the async OpenCode session creation call (`validateSpawn`), then re-validate in `addSpawnedMember` as defense-in-depth after the async gap.
- Store the spawned session id only after OpenCode session creation succeeds.
- Render spawn instruction separately from initial prompt in code, then concatenate them into a single `spawn_initial` message/delivery for atomic delivery. If neither instruction nor prompt produces content, no spawn_initial delivery is created.
- Resolve spawn instruction via shared `resolveCollabTemplates` infrastructure that also handles reply instructions. Template sources support `{ text }` and `{ file }` configurations.
- Derive caller defaults by inspecting the planner's message history (last assistant message's agent/model) rather than only session metadata, providing more accurate model selection.

## Risks / Trade-offs

- Caller-derived defaults may be unavailable -> Fall back to configured or OpenCode defaults and test explicit override behavior.
- Initial prompt delivery depends on bootstrap success -> Keep initial prompt pending until bootstrap is marked delivered.
- Redundant validation in validateSpawn + addSpawnedMember -> Accepted as defense-in-depth against state changes during async session creation.
