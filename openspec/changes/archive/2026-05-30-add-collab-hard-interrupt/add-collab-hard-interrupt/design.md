## Context

Hard interrupt is the only v1 mode that can abort through `busy` or `retry` (`notes/agent-collaboration.md` line 201). The PRD requires strict planner checks before aborting and multi-target all-or-nothing behavior (lines 823-849).

## Goals / Non-Goals

**Goals:**
- Add hard mode creation from `POST /room/:room_id/message` when `hard: true`.
- Validate active planner sender and active non-self targets before creating hard deliveries.
- Implement abort/wait/inject barrier with timeout scaling and chronological batch preservation.

**Non-Goals:**
- No force-push-like unsafe bypasses, partial target injection, or non-planner hard mode.

## Decisions

- Perform strict validation before creating hard delivery records so validation failures are not retried.
- For execution failures after records exist, mark all targeted records failed together to preserve all-or-nothing semantics.
- Reuse prompt formatting and ordering from immediate delivery after the idle barrier succeeds.

## Risks / Trade-offs

- Aborting sessions is disruptive -> Planner-only validation and explicit `hard` flag are mandatory and covered by tests.
- Multi-target waits can be slow -> Timeout scales by target count but is capped per configuration.
