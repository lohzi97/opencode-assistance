## Context

The PRD requires buffered deliveries to wait while a target is busy, retrying, answering a user question, or blocked by unresolved collab questions (`notes/agent-collaboration.md` lines 185-193). This change implements only buffered mode; immediate and hard modes extend the same ordered backlog logic later.

## Goals / Non-Goals

**Goals:**
- Add a delivery engine with fallback polling and SSE-triggered wakeups.
- Inject buffered backlogs in strict chronological order per target.
- Inject join bootstrap before any later room traffic for the target.

**Non-Goals:**
- No immediate soft delivery, hard aborts, questions API, or close-drain exceptions beyond ignoring closed rooms for new work.

## Decisions

- Implement one delivery engine loop with testable `attemptFlush(target)` internals to avoid timing-heavy tests.
- Format injected prompts as self-contained collaboration messages using PRD lines 743-779.
- Mark deliveries delivered only after successful `prompt_async` response.

## Risks / Trade-offs

- Poll/SSE races can duplicate injection -> Use delivery state transitions guarded by database updates and verify idempotence.
- Join bootstrap must precede normal traffic -> Use chronological creation ordering plus explicit bootstrap priority tests.
