## Context

Questions are room messages with stronger target tracking: they remain unresolved until every target answers or is cancelled (`notes/agent-collaboration.md` lines 653-665). Answers notify the asker immediately, while other members receive buffered room traffic (lines 666-679).

## Goals / Non-Goals

**Goals:**
- Implement `POST /room/:room_id/ask` and `POST /room/:room_id/answer`.
- Track target state in `question_targets`.
- Integrate unresolved question blockers into buffered eligibility.

**Non-Goals:**
- No OpenCode `/question` UI integration beyond existing pending-user-question blocker.
- No structured readiness or task status workflow.

## Decisions

- Represent questions and answers in the same `messages` table with `kind` and `parent_id` to preserve transcript visibility.
- Treat answer body mentions as informational only for non-askers, matching PRD line 677.
- Cancel unresolved targets on close without creating new post-close failure messages.

## Risks / Trade-offs

- `@everyone` target expansion can become stale if membership changes -> Store concrete target rows at ask time.
- Answers after close could conflict with drain behavior -> Reject all answers after close as specified.
