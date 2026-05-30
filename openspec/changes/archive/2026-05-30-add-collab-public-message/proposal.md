## Why

The PRD uses the room public message as planner-owned shared context, similar to a pinned room note, and requires it to appear in future collaboration deliveries. This change implements PRD lines 116-129, 445-481, and 743-748.

## What Changes

- Add planner-only set/replace and clear APIs for room public message.
- Persist public message text, updater alias, and update timestamp.
- Emit normal room messages for updates and clears.
- Deliver update/clear notifications as immediate soft interrupts to other members and include the latest public message in future injections.

## Capabilities

### New Capabilities
- `collab-public-message`: Planner-owned room public message management and delivery context injection.

### Modified Capabilities
- None.

## Impact

- Extends room status, message creation, and prompt formatting.
- Depends on immediate delivery for notification routing.
