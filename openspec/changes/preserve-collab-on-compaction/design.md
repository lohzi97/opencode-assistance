## Context

The project worker runs `CompactionService` and `CollabService` in the same Bun process with a shared `OpenCodeClient`. `CompactionService` creates a fresh OpenCode session when a source session crosses the configured context threshold, then prompts that continuation with a structured summary. `CollabService` persists rooms, active members, deliveries, spawned sessions, and question targets keyed by OpenCode `session_id`.

That creates a mismatch: after compaction, the logical collaborator is still the same alias and role, but the active OpenCode session has changed. Without a handoff, sender validation, pending delivery flushes, hard interrupts, pending question blockers, spawned-session ownership, and room status keep using the superseded session.

## Goals / Non-Goals

**Goals:**

- Preserve active collaboration membership across custom compaction rollover.
- Retarget pending deliveries and pending question targets atomically from the source session to the continuation session.
- Keep room aliases and roles stable; the member identity remains the alias in the room, not the physical session id.
- Record audit history for each session handoff.
- Notify the room and the continuation session that a handoff occurred.
- Keep the change additive and internal to the worker services.

**Non-Goals:**

- No new public `agent-collab` CLI command for manual session migration in v1.
- No support for cross-backend or cross-machine handoff.
- No migration of already injected historical messages.
- No changes to OpenCode's native session model.
- No attempt to merge conversation history into the collab SQLite transcript beyond the existing compaction summary prompt.

## Decisions

### Decision: Use an in-process service hook

`CompactionService` should notify collab after the continuation session has been created, persisted in compaction state, and successfully prompted. The worker should wire the services so compaction can call a narrow callback such as `onSessionSuperseded(sourceSessionId, continuationSessionId, metadata)`.

Alternatives considered:

- HTTP callback to the collab API: rejected because both services already share a process and client; HTTP adds avoidable failure modes and auth surface.
- Collab polling compaction state: rejected because it delays retargeting and couples collab to compaction's private state file format.
- Agents manually rejoin rooms after compaction: rejected because it is unreliable and loses pending routing continuity.

### Decision: Treat `members.session_id` as the mutable current route

The active `members` row should be updated from the old session id to the continuation session id. Alias, role, state, joined timestamp, directory, agent, model, and variant remain attached to the logical room member.

This preserves existing validation rules: after handoff, CLI calls must use the continuation `--session` with the same `--from` alias. The old session can no longer send as that member because it is no longer the active route.

### Decision: Retarget pending rows atomically

The collab storage operation should run in one SQLite transaction that:

- Finds active memberships for the source session.
- Skips closed rooms unless pre-close pending deliveries still need close-drain retargeting for that active member.
- Updates `members.session_id` to the continuation session id.
- Updates pending `deliveries.target_session_id` rows from old to new for those rooms.
- Updates pending `question_targets.target_session_id` rows from old to new for those rooms.
- Updates `spawned_sessions.session_id` for spawned room members.
- Inserts `member_session_history` rows for audit.
- Inserts a system message documenting the handoff.
- Queues a bootstrap/reminder delivery to the continuation session.

Atomicity matters because partial retargeting could make the new session pass sender validation while old pending deliveries still target the old session, or vice versa.

### Decision: Add explicit handoff history

Add a table such as:

```sql
CREATE TABLE IF NOT EXISTS member_session_history (
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  old_session_id TEXT NOT NULL,
  new_session_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, old_session_id, new_session_id)
);
```

This gives operators and tests a durable way to verify what happened without overloading `messages` or `members` for audit purposes.

### Decision: Notify both transcript and continuation session

The handoff should create a system message visible in the room transcript and queue a direct bootstrap/reminder delivery to the continuation session. The reminder should state the room name, alias, role, source session id, continuation session id, and reply guidance.

The transcript message helps other collaborators understand why a member changed sessions. The continuation reminder helps the rolled-over agent retain live room identity even if the compaction summary omitted it.

### Decision: Idempotent best-effort callback from compaction

The compaction flow should not fail or roll back the continuation if collab handoff finds no active room membership. If a matching handoff already exists for the same old/new pair, the storage operation should return success without duplicating transcript or reminder messages.

If collab handoff fails unexpectedly, compaction should log a warning with source and continuation ids. The continuation remains valid, but collab may need manual repair or rejoin.

## Risks / Trade-offs

- [Risk] A continuation session might already belong to another open room. → Reject the handoff for that room and log a warning; this should be impossible for compaction-created sessions under normal flow.
- [Risk] Updating `members.session_id` changes primary-key-like behavior even though the current primary key is `(room_id, session_id)`. → Perform collision checks inside the transaction before updating.
- [Risk] A pending delivery could be injected into the old session between continuation creation and handoff. → Call the handoff immediately after successful continuation prompt and before marking the source as complete where practical; collab delivery ticks should see the new route after the transaction.
- [Risk] The old source session may still be idle and able to run commands. → Sender validation will reject it after handoff because the active member row now points to the continuation session.
- [Risk] Existing closed-room backlog semantics are subtle. → Limit v1 handoff to active member rows and pending pre-close rows for the same room; do not reopen or mutate closed room state except for already-valid close-drain routing.

## Migration Plan

1. Add the `member_session_history` table with `CREATE TABLE IF NOT EXISTS` during collab migration.
2. Add storage-level tests for handoff migration, pending delivery retarget, pending question retarget, spawned-session update, and idempotency.
3. Add `CollabService.handleSessionSuperseded(...)` as an internal method that delegates to storage and optionally triggers delivery flush.
4. Wire `CompactionService` to accept an optional session-superseded callback from the worker.
5. Invoke the callback after a continuation is successfully prompted.
6. Add an integration test or smoke-test script that creates a room, simulates handoff, sends from the new session, and verifies pending delivery routes.

Rollback is safe because the migration is additive. If the handoff code is disabled, existing collab behavior remains unchanged, though compacted sessions will again require manual room recovery.

## Open Questions

None for v1. The preferred behavior is automatic, internal handoff for custom compaction-created continuation sessions only.
