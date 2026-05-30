## Context

The collaboration service has two instruction concepts today: `spawn_instruction` and `reply_instruction`. `reply_instruction` is used as expected in every delivered collaboration prompt, but `spawn_instruction` is only resolved inside the spawn route and is queued as part of the later `spawn_initial` delivery. The first prompt received by added, joined, or spawned members remains the built-in join bootstrap text.

The intended operator control point is the join bootstrap itself: the first room message a session receives when it becomes a member. The implementation should therefore move the configurable instruction from spawn-only prompt composition into join-bootstrap composition.

## Goals / Non-Goals

**Goals:**

- Rename the configuration concept from `spawn_instruction` to `room_join_instruction`.
- Apply `room_join_instruction` to all membership entry paths: planner-managed member add, password self-join, and spawn.
- Preserve the existing invariant that join bootstrap is delivered before later room traffic and before any spawn `initial_prompt`.
- Keep `reply_instruction` behavior unchanged.
- Keep the implementation minimal and avoid schema changes unless strictly needed.

**Non-Goals:**

- No new readiness tracking or structured member state.
- No change to room founder behavior; room creation still records founder membership without injecting a prompt back to the founder.
- No backward-compatible dual support for `spawn_instruction` unless implementation review identifies a concrete migration requirement.
- No change to OpenCode session creation APIs beyond existing spawn behavior.

## Decisions

- Use `room_join_instruction` as the single configurable template for join bootstrap content.
  Alternative considered: keep `spawn_instruction` and also add `room_join_instruction`. That would preserve compatibility but keep an ambiguous, misleading knob. Since this is a newly built collaboration service under active testing, a clean breaking rename is preferable.

- Store the rendered room join instruction in the existing `join_bootstrap` message body.
  Alternative considered: add a new database column or delivery metadata for bootstrap templates. The existing `messages.body` already carries injected message content and preserves transcript visibility, so no schema migration is needed.

- Resolve the room join template before inserting the bootstrap message.
  Alternative considered: store placeholders and render at delivery time. Rendering at insert time matches current spawn instruction behavior, captures the room/member context at join time, and avoids future prompt drift if config changes while deliveries are pending.

- Render bootstrap prompts from `join_bootstrap` message bodies instead of hardcoded onboarding text.
  Alternative considered: concatenate configured text with the hardcoded availability sentence. The existing template semantics are full replacement with no implicit merge behavior, so configurable room join content should fully replace fallback content.

- Keep spawn `initial_prompt` as a separate `spawn_initial` delivery after bootstrap.
  Alternative considered: merge `initial_prompt` into the configured bootstrap. That would make task assignment part of onboarding and weaken the ordering guarantee that bootstrap succeeds before assignment begins.

## Risks / Trade-offs

- Existing `server.jsonc` using `spawn_instruction` will stop customizing prompts -> Mitigate by updating the repository config and documenting the breaking rename in the proposal and specs.
- Removing the default hardcoded ready sentence could produce templates without availability guidance -> Mitigate with a fallback `room_join_instruction` that includes the ready convention.
- Rendering at join time means queued bootstrap prompts do not reflect later template edits -> This is acceptable because room join context should be stable and delivery should preserve what was true when the member joined.
- Async template loading may be needed in member add and self-join paths -> Mitigate by keeping template resolution at the service layer and passing rendered text into storage methods.

## Migration Plan

- Rename `.opencode/collab-spawn.md` to `.opencode/collab-room-join.md` or create the new file with equivalent content.
- Update `.opencode/server.jsonc` from `collab.spawn_instruction.file` to `collab.room_join_instruction.file`.
- Update the worker config type and parser to expose `room_join_instruction` only.
- Restart the worker after deployment so the updated config is loaded.
- Rollback is to restore the previous config key and code version, then restart the worker.

## Open Questions

None.
