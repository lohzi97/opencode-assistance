## Why

Agents need a thin bash-friendly interface to use room and membership APIs without crafting HTTP requests. This change implements the room and membership CLI surface from PRD lines 680-713 and output/password rules from lines 727-741.

## What Changes

- Add `agent-collab` CLI base URL handling with default `http://127.0.0.1:9100` and `AGENT_COLLAB_URL` override.
- Add room create/status/list and public room naming support for human-readable and JSON output.
- Add member add/remove, join, leave, and spawn commands with explicit caller identity flags.
- Support self-join password input through `--password` and `--password-stdin`.

## Capabilities

### New Capabilities
- `agent-collab-cli-room-membership`: CLI commands for room lifecycle, membership governance, join/leave, and spawn workflows.

### Modified Capabilities
- None.

## Impact

- Adds executable CLI packaging or script entry point.
- Depends on collab HTTP APIs through spawn.
