## Context

The PRD treats close as terminal for new mutations but not as deletion or immediate delivery cancellation (`notes/agent-collaboration.md` lines 238-247). Already-created buffered deliveries and closure messages may still drain, and retention is indefinite by default (lines 248-252).

## Goals / Non-Goals

**Goals:**
- Implement close-drain delivery selection for buffered, immediate, and already-created hard deliveries.
- Cancel unresolved question targets at close.
- Surface outstanding permanent failures in status and detailed message views.

**Non-Goals:**
- No manual purge capability, room reopening, or spawned-session abortion.

## Decisions

- Mark close time and use delivery creation time to distinguish pre-close records from forbidden post-close mutations.
- Reuse normal chronological batching during close drain, including immediate and hard records created before close.
- Classify validation failures as permanent and transport/backend failures as retryable.

## Risks / Trade-offs

- Closed rooms still performing delivery may surprise operators -> Status and message views must expose pending/failed drain state.
- Failure classification mistakes can cause loops or dropped messages -> Unit-test each classification path.
