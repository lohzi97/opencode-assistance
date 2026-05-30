## Context

The PRD requires immediate soft delivery to interrupt busy sessions but not sessions in retry or waiting on user questions (`notes/agent-collaboration.md` lines 194-199). It also requires older buffered context to be injected first when an immediate message is behind buffered items for the same target (lines 209-212).

## Goals / Non-Goals

**Goals:**
- Add immediate delivery eligibility and mixed-mode batching.
- Preserve strict per-target chronological ordering.
- Keep urgency independent from message kind.

**Non-Goals:**
- No hard abort, public-message update notifications, or ask/answer specialization.

## Decisions

- Evaluate queues per target and creation time, not by source message, matching PRD lines 205-207.
- Treat immediate delivery as a batch trigger that may carry older buffered messages rather than skipping the backlog.

## Risks / Trade-offs

- Immediate messages could be delayed by older blocked buffered items -> This is required by chronological context preservation.
- Busy-session injection can surprise agents -> Prompt format must clearly label room, sender, and kind.
