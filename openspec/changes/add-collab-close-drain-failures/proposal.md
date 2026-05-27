## Why

Closing a room must stop new collaboration mutations without losing already-created backlog, and delivery failures must remain inspectable. This completes PRD closure, close-drain, and failure handling from `notes/agent-collaboration.md` lines 236-247, 819-821, 835-838, 850-879, and 948-950.

## What Changes

- Allow pending deliveries created before close, plus closure message deliveries, to drain chronologically after room closure.
- Ignore unresolved collab-question blockers during close drain while still respecting busy, retry, and pending user-question blockers.
- Allow existing pending hard deliveries to execute after close without reapplying the open-room precondition.
- Retry transient failures, avoid retrying validation failures, and surface permanent failures in room status and message views.

## Capabilities

### New Capabilities
- `collab-close-drain-failures`: Closed-room backlog draining, close-time cancellation, retry classification, and permanent failure visibility.

### Modified Capabilities
- None.

## Impact

- Refines room close behavior across delivery, questions, hard interrupts, status, and messages.
- Completes the v1 lifecycle semantics before CLI exposure.
