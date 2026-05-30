## Why

The collaboration service currently treats `collab.spawn_instruction` as a spawned-session follow-up prompt, but the operational intent is to configure the first room-join message that every newly joined session receives. This creates surprising behavior: spawned sessions first receive the built-in `[Join Bootstrap]`, while the configured instruction arrives only later, and existing-session joins never receive it at all.

## What Changes

- Replace the configuration concept `collab.spawn_instruction` with `collab.room_join_instruction`.
- Render `room_join_instruction` into the join bootstrap prompt for planner-managed member add, password-based self-join, and planner-managed spawn.
- Keep the join bootstrap as the first injected message for newly joined members, including spawned members.
- Change spawn behavior so `initial_prompt` remains a post-bootstrap prompt and is no longer concatenated with the old spawn instruction.
- Rename the default configured file from `.opencode/collab-spawn.md` to a room-join-oriented file such as `.opencode/collab-room-join.md`.
- Update documentation, specs, and tests to reflect room-join semantics rather than spawned-session-only semantics.
- **BREAKING**: `collab.spawn_instruction` is removed or ignored in favor of `collab.room_join_instruction`; deployments must update `server.jsonc`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: Collab configuration now defines `room_join_instruction` and `reply_instruction`, with template loading semantics for room join prompts.
- `collab-delivery`: Join bootstrap prompt content becomes configurable through `room_join_instruction` while preserving bootstrap-first delivery ordering and self-contained injection format.
- `collab-spawn`: Spawned sessions receive the configured room join bootstrap first, and spawn `initial_prompt` remains a separate post-bootstrap delivery without old spawn-instruction concatenation.

## Impact

- Affected config: `.opencode/server.jsonc`, `CollabConfig`, and config parsing.
- Affected templates: `.opencode/collab-spawn.md` should be renamed or replaced by `.opencode/collab-room-join.md`.
- Affected service code: `CollabService`, `CollabStorage.insertJoinBootstrap`, delivery formatting, and spawn prompt queueing.
- Affected tests: collab config/template tests, join bootstrap delivery tests, member-add/self-join tests, and spawn ordering tests.
- Affected docs/specs: `notes/agent-collaboration.md`, `collab-core`, `collab-delivery`, and `collab-spawn` specs.
- Operational requirement: the worker must be restarted after config changes because collab config is loaded at service startup.
