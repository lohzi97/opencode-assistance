## 1. Schema Migration

- [x] 1.1 Add `agent`, `model_provider_id`, `model_id`, `model_variant` nullable TEXT columns to `members` table in the `migrate()` method using the existing `ensureColumn` pattern
- [x] 1.2 Verify migration is additive: existing member rows retain `NULL` for all new columns, no data loss on upgrade

## 2. Member Row Write at Membership Time

- [x] 2.0 In `createRoom()` founder auto-join, query the founder session's last user message and pass agent/model/variant to the member-insert call
- [x] 2.1 Add `SpawnPromptOptions` parameter to `insertMember()` (or extend the member-insert path) so that agent/model/variant are written to the `members` row at insert time
- [x] 2.2 In `addSpawnedMember()`, pass the resolved `spawnPrompt` (already computed) to the member-insert call so the member row stores the spawn-time agent/model/variant
- [x] 2.3 In `addMember()` (planner-managed add), query the target session's last user message via `callerDefaults()` or a new `sessionAgentModel()` helper to capture the target session's agent/model, then pass it to the member-insert call
- [x] 2.4 In `selfJoin()`, query the joining session's last user message to capture its agent/model/variant, then pass it to the member-insert call
- [x] 2.5 Ensure all membership paths gracefully store `NULL` agent/model when the session history query fails or returns no messages

## 3. Delivery Engine Agent/Model Lookup

- [x] 3.1 Replace `promptOptions()` with a new method that reads agent/model/variant from the target session's active member row instead of scanning delivery rows for `spawn_initial`
- [x] 3.2 Update `attemptFlush()` (line 557) to use the new member-lookup method for its `promptAsync` call
- [x] 3.3 Update `attemptHardFlush()` (line 519) to pass the target member's agent/model/variant on the `promptAsync` call (currently passes nothing)
- [x] 3.4 Ensure `NULL` agent/model on the member row results in omitting agent/model from `promptAsync` (preserves current fallback behavior)

## 4. Storage Layer Updates

- [x] 4.1 Add a helper method to `CollabStorage` that returns the agent/model/variant for a given `(room_id, session_id)` active member row
- [x] 4.2 Update the `pendingBacklogForTarget` query to also select member-level agent/model/variant columns (or use the new helper in the delivery engine)
- [x] 4.3 Remove the now-redundant `spawn_initial`-specific logic from `promptOptions()` (keep delivery-row columns for forensic purposes but do not read them for prompt options)

## 5. Tests

- [x] 5.1 Add unit test: spawn stores agent/model on member row
- [x] 5.2 Add unit test: member add captures session agent/model from API
- [x] 5.3 Add unit test: self-join captures session agent/model from API
- [x] 5.4 Add unit test: delivery engine passes member agent/model on buffered delivery
- [x] 5.5 Add unit test: delivery engine passes member agent/model on immediate delivery
- [x] 5.6 Add unit test: delivery engine passes member agent/model on hard delivery
- [x] 5.7 Add unit test: NULL agent/model member row results in no agent/model override on delivery
- [x] 5.8 Verify existing collab tests still pass after the changes
