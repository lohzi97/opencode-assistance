## Why

The collaboration service exposes terminal room closure through `DELETE /room/:room_id`, but the current CLI script does not provide a corresponding command. This leaves operators with create/status/list and membership commands, yet no script-level way to perform the explicit close action required by the room lifecycle.

## What Changes

- Add `room close --room <name> --session <planner_session_id> --from <planner_alias> [--json]` to `.opencode/scripts/agent-collab.ts` as a thin wrapper over the existing room close API.
- Preserve existing CLI behavior: human-readable output by default, `--json` for structured output, `AGENT_COLLAB_URL` base URL override, and server-side authorization semantics.
- No breaking changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-cli`: add the missing room close command for the existing room lifecycle API.

## Impact

- Affected code: `.opencode/scripts/agent-collab.ts`.
- Affected specs: `openspec/specs/collab-cli/spec.md` via a delta spec for room close behavior.
- Affected tests: CLI tests for room close request shape, human-readable close output, JSON passthrough, and server error handling.
- No database schema changes and no server API changes are expected.
