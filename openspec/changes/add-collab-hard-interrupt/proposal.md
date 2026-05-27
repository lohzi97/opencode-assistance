## Why

Hard interrupt is the planner-only emergency delivery path that can abort busy or retrying targets, but it must be strict and all-or-nothing to avoid inconsistent context. This implements PRD lines 180-184, 201, and 823-849.

## What Changes

- Add `hard` message routing for planner-authored messages with validated targets.
- Abort all targeted sessions first, wait for all to become idle, and inject none if any target fails the barrier.
- Scale wait timeout by target count capped by `hard_abort_wait_max_ms`.
- Preserve older buffered context before the hard message in the injected chronological batch.

## Capabilities

### New Capabilities
- `collab-hard-interrupt`: Planner-only hard interrupt delivery with all-or-nothing abort, wait, timeout, and ordered injection semantics.

### Modified Capabilities
- None.

## Impact

- Extends message send and delivery engine behavior.
- Requires OpenCode abort/session-control client support.
