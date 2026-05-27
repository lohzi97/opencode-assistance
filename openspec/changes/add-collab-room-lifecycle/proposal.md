## Why

Rooms are the core managed group-chat primitive in the PRD and must exist before membership, messaging, or delivery behavior can be implemented. This change covers PRD room concepts and room APIs in `notes/agent-collaboration.md` lines 71-80, 349-444, and 976-983.

## What Changes

- Add room creation with explicit base name, explicit founder alias, planner auto-join, unique timestamped full room name, and one-time planner password return.
- Add room status and list read APIs that never expose password data.
- Add terminal room close API with planner-only authorization and a final closure message record.
- Enforce one open room per founder session and `open | closed` lifecycle state.

## Capabilities

### New Capabilities
- `collab-room-lifecycle`: Creation, inspection, listing, and closure of collaboration rooms.

### Modified Capabilities
- None.

## Impact

- Adds initial HTTP routes under the collab service.
- Requires the config/state foundation from `add-collab-config-state`.
