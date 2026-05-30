## Why

Mentioned messages need faster delivery than ordinary buffered traffic while still preserving chronological context. This change implements immediate soft interrupt routing from PRD lines 164-184, 194-214, and 803-807.

## What Changes

- Deliver mention-targeted messages as immediate soft interrupts.
- Allow immediate delivery during `busy` but block on pending user questions and `retry`.
- If older buffered items exist for the same target, inject one combined chronological batch ending with the immediate message.
- Keep message `kind` informational and urgency controlled by mentions only.

## Capabilities

### New Capabilities
- `collab-immediate-delivery`: Mention-triggered immediate soft delivery with blocker and chronological batch semantics.

### Modified Capabilities
- None.

## Impact

- Extends the delivery engine from buffered-only to mixed buffered/immediate queues.
- Depends on message transcript and buffered delivery foundations.
