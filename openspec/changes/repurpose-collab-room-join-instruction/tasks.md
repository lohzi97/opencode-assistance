## 1. Configuration And Templates

- [x] 1.1 Update `CollabConfig` to replace `spawn_instruction` with `room_join_instruction`.
- [x] 1.2 Update collab config parsing to read `collab.room_join_instruction` and stop reading `collab.spawn_instruction`.
- [x] 1.3 Rename the configured template file from `.opencode/collab-spawn.md` to `.opencode/collab-room-join.md` or create the new file with room-join content.
- [x] 1.4 Update `.opencode/server.jsonc` to reference `collab.room_join_instruction.file`.

## 2. Join Bootstrap Behavior

- [x] 2.1 Rename the fallback spawn instruction constant to a room-join fallback and ensure it includes availability guidance.
- [x] 2.2 Update template resolution so `room_join_instruction` and `reply_instruction` are rendered with `{room}`, `{alias}`, `{role}`, and `{from}` variables.
- [x] 2.3 Resolve the room join instruction before planner-managed `member add` inserts the bootstrap message.
- [x] 2.4 Resolve the room join instruction before password-based `join` inserts the bootstrap message.
- [x] 2.5 Resolve the room join instruction before `spawn` inserts the bootstrap message.
- [x] 2.6 Store the rendered room join instruction as the `join_bootstrap` message body.
- [x] 2.7 Render bootstrap prompt content from the stored `join_bootstrap` message body instead of hardcoded onboarding text.

## 3. Spawn Behavior

- [x] 3.1 Stop passing or storing spawn-specific instruction text in the spawn member path.
- [x] 3.2 Change spawn `spawn_initial` creation so it contains only `initial_prompt` when provided.
- [x] 3.3 Preserve existing delivery ordering so spawned sessions receive `join_bootstrap` before `spawn_initial`.
- [x] 3.4 Ensure no `spawn_initial` delivery is created when spawn omits `initial_prompt`.

## 4. Tests

- [x] 4.1 Update config/template tests for `room_join_instruction` text, file, fallback, and unknown placeholder behavior.
- [x] 4.2 Add or update member-add tests proving the first bootstrap prompt contains configured room join content.
- [x] 4.3 Add or update password self-join tests proving the first bootstrap prompt contains configured room join content.
- [x] 4.4 Update spawn ordering tests proving room join content appears in the first bootstrap prompt and `initial_prompt` appears only in the later `spawn_initial` prompt.
- [x] 4.5 Add or update tests proving configured room join content fully replaces fallback bootstrap body rather than being implicitly merged.

## 5. Documentation And Verification

- [x] 5.1 Update `notes/agent-collaboration.md` to document `room_join_instruction` and remove `spawn_instruction` semantics.
- [x] 5.2 Update relevant existing OpenSpec source specs if implementation changes are made outside this proposal flow.
- [x] 5.3 Run `bun test .opencode/server/collab.test.ts` and fix any failures.
- [x] 5.4 Run `openspec status --change repurpose-collab-room-join-instruction` and confirm the change remains apply-ready.
- [x] 5.5 Restart the worker after deployment so the updated collab config is loaded.
