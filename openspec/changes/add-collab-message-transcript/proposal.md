## Why

After rooms and members exist, the service needs a shared transcript and deterministic targeting before any delivery engine can inject prompts. This implements PRD message visibility, sender identity, message kinds, and messaging APIs from `notes/agent-collaboration.md` lines 130-163 and 610-650.

## What Changes

- Add member-authored room messages with `session_id + alias` identity validation.
- Parse `@alias` and `@everyone` mentions, reject unknown mentions, skip self-delivery, and create delivery records with buffered or immediate mode.
- Add room-wide and member-scoped transcript APIs with delivery-state annotations.
- Keep `kind` informational except for persisted defaults and display.

## Capabilities

### New Capabilities
- `collab-message-transcript`: Room message creation, mention targeting, transcript visibility, and delivery-state inspection.

### Modified Capabilities
- None.

## Impact

- Extends collab API with `POST /room/:room_id/message` and `GET /room/:room_id/messages`.
- Creates delivery records consumed by later delivery proposals.
