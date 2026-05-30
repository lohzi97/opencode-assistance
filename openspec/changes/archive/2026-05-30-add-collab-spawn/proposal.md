## Why

Planner-managed spawning lets a room create new collaborator sessions without manual session setup, while preserving bootstrap-first ordering. This implements PRD spawn behavior from `notes/agent-collaboration.md` lines 577-609 and spawn instruction configuration from lines 894-910.

## What Changes

- Add planner-only `POST /room/:room_id/spawn` API.
- Create a new OpenCode session using explicit or caller-derived agent/model/directory defaults.
- Record spawned ownership in `spawned_sessions` and join the created session as a room member.
- Deliver join bootstrap before the spawn `initial_prompt`.
- Render spawn instruction from configurable text/file template sources, falling back to a built-in template.
- Validate planner status and alias uniqueness before the OpenCode session creation call.

## Capabilities

### New Capabilities
- `collab-spawn`: Planner-managed OpenCode session creation and immediate room membership with bootstrap-first prompt ordering. Supports explicit agent, model (providerID, modelID, variant), and directory overrides, with caller-derived defaults from the planner's last assistant message. Spawn instruction is rendered via shared template infrastructure (`resolveCollabTemplates`) that also supports reply instructions.

### Modified Capabilities
- None.

## Impact

- Extends CollabService with `spawnMember`, `callerDefaults`, and `validateSpawn` methods.
- Adds `createSpawnSession` to OpenCodeClient (title in body, directory as URL param).
- Adds `spawned_sessions` table and `spawn_initial` delivery mode.
- Adds `model_variant` column to deliveries for spawn prompt agent/model passthrough.
- Uses shared `resolveCollabTemplates` infrastructure (covers both spawn and reply instructions).
- Depends on membership, buffered delivery, and template foundations.
