## Why

Planner-managed spawning lets a room create new collaborator sessions without manual session setup, while preserving bootstrap-first ordering. This implements PRD spawn behavior from `notes/agent-collaboration.md` lines 577-609 and spawn instruction configuration from lines 894-910.

## What Changes

- Add planner-only `POST /room/:room_id/spawn` API.
- Create a new OpenCode session using explicit or caller-derived agent/model/directory defaults.
- Record spawned ownership in `spawned_sessions` and join the created session as a room member.
- Deliver join bootstrap before the spawn `initial_prompt`.

## Capabilities

### New Capabilities
- `collab-spawn`: Planner-managed OpenCode session creation and immediate room membership with bootstrap-first prompt ordering.

### Modified Capabilities
- None.

## Impact

- Extends CollabService OpenCodeClient usage and membership flow.
- Depends on membership, buffered delivery, and template foundations.
