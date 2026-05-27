## Context

The PRD makes only `planner` semantically special and allows multiple planners while requiring at least one planner in every open room (`notes/agent-collaboration.md` lines 86-92). Join bootstrap injection is delivered later, but membership must create the durable work item now (lines 215-235).

## Goals / Non-Goals

**Goals:**
- Implement `POST /room/:room_id/member`, `POST /room/:room_id/join`, `DELETE /room/:room_id/leave`, and `DELETE /room/:room_id/member`.
- Validate aliases with `[a-z0-9][a-z0-9-]*` from PRD lines 94-103.
- Create system messages and pending delivery records needed by later delivery engines.

**Non-Goals:**
- No prompt injection, spawn, message sending, or readiness tracking.

## Decisions

- Use `session_id + alias` validation for member-authored mutations to match PRD sender identity rules.
- Represent leave/remove by member state changes rather than deletion so transcripts remain stable.
- Store bootstrap as a pending special delivery linked to membership state so later delivery can guarantee ordering.

## Risks / Trade-offs

- Bootstrap records without injection are not user-visible yet -> API tests verify records and ordering keys until delivery is implemented.
- Planner-password self-join expands planner authority -> Tests must prove invalid passwords do not reveal whether aliases are available beyond ordinary validation errors.
