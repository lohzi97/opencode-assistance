## Context

The PRD separates transcript visibility from delivery urgency: all members can see all room messages, while delivery targets control injection behavior (`notes/agent-collaboration.md` lines 132-135). This change records intent and target state without performing injection.

## Goals / Non-Goals

**Goals:**
- Implement message persistence and transcript reads.
- Implement mention parsing and target expansion for `@alias`, multiple mentions, `@everyone`, and no mention.
- Create delivery records with `buffered` or `immediate` mode.

**Non-Goals:**
- No prompt injection, hard interrupt execution, ask/answer workflow, or public-message behavior.

## Decisions

- Treat mention parsing as a pure utility with exhaustive unit tests because later delivery modes depend on it.
- Store mentions as a normalized JSON alias array so transcript views do not need to reparse bodies.
- Reject an entire message when any mention is unknown, matching PRD line 177.

## Risks / Trade-offs

- Mention syntax could conflict with prose -> v1 only interprets strict active aliases and `@everyone`; unknown mentions reject visibly.
- Delivery records accumulate before engines exist -> Tests verify pending state and later proposals drain them.
