## Context

The agent collaboration service (`agent-collab`) injects messages into OpenCode sessions via `POST /session/:id/prompt_async`. OpenCode's `createUserMessage` (in `session/prompt.ts`) resolves the agent and model for each prompt independently:

- **Agent**: `input.agent` -> `agents.defaultAgent()` (system default, NOT the session's last agent)
- **Model**: `input.model` -> `ag.model` -> `lastModel(sessionID)` (agent's config model, then session history)
- **Variant**: `input.variant` -> agent variant config (conditional on model match)

The collab service's current `promptOptions()` only passes agent/model/variant when a `spawn_initial` delivery is in the batch. All other deliveries (bootstrap, buffered, immediate, hard) call `promptAsync` without these fields, causing the session to revert to the default agent and model on every injection.

This affects all room members: spawned sessions lose their configured agent/model, and existing sessions added via `member add` also revert to defaults on every collab delivery.

## Goals / Non-Goals

**Goals:**
- Persist each member session's effective agent/model/variant in the `members` table.
- Pass the stored agent/model/variant on every `promptAsync` call from the delivery engine.
- Capture agent/model/variant at join time for all membership paths: room creation founder auto-join, spawn, member add, and self-join.

**Non-Goals:**
- Per-message agent/model overrides (the stored member-level values are used consistently).
- Runtime updates to member agent/model after initial capture (a future enhancement if needed).
- Changes to the CLI or HTTP API surface (tracking is fully internal).
- Changes to the `deliveries` table schema or `spawn_initial` delivery row semantics.

## Decisions

### D1: Store agent/model on the `members` table, not just delivery rows

**Choice**: Add `agent`, `model_provider_id`, `model_id`, `model_variant` columns to `members`.

**Rationale**: The delivery row approach (current `spawn_initial`-only storage) is fragile because:
- Delivery rows are transient (marked `injected` and never re-read after flush).
- The delivery engine would need to scan backwards through injected deliveries to find the last agent/model, which is unreliable after compaction or delivery cleanup.
- Agent/model is a property of the member's session identity, not of individual deliveries.

**Alternative considered**: Query the session's last user message at delivery time. Rejected because it adds an API round-trip on every delivery flush, increasing latency and failure surface.

### D2: Capture agent/model at membership time for all four paths

**Choice**: Each membership path resolves agent/model differently:

- **Spawn**: Use the resolved spawn-time agent/model (already computed via `callerDefaults` + explicit overrides).
- **Room creation founder**: Query the founder session's last user message from the OpenCode API at room creation time.
- **Member add**: Query the target session's last user message from the OpenCode API at add time.
- **Self-join**: Query the joining session's last user message from the OpenCode API at join time.

**Rationale**: Spawn already has the agent/model from the planner's explicit input or caller defaults. For room creation founder, member add, and self-join, the session already exists, so the last user message's agent/model is the authoritative source.

**Fallback**: If the API query fails or returns no messages, store `NULL` for all fields. When the delivery engine encounters `NULL` agent/model on a member row, it omits the fields from `promptAsync`, falling back to OpenCode's default resolution (same as current behavior).

### D3: Replace `promptOptions()` with member-row lookup

**Choice**: The delivery engine reads agent/model from the `members` table for the target session, not from delivery rows.

**Rationale**: The member row is the single source of truth. The `deliveries` table columns (`agent`, `model_provider_id`, `model_id`, `model_variant`) on `spawn_initial` deliveries become redundant but are kept for backward compatibility and forensic purposes.

### D4: Hard delivery also passes agent/model

**Choice**: The hard delivery path (line 519) currently calls `promptAsync` without any agent/model. After this change, it reads from the member row like all other delivery paths.

**Rationale**: Hard delivery should preserve session identity just like buffered and immediate deliveries.

## Risks / Trade-offs

- **[Migration risk]** Adding columns to the `members` table is additive and safe via `ALTER TABLE ADD COLUMN`. Existing rows have `NULL` values, which the delivery engine handles as "no override" (preserving current behavior for pre-existing members). -> Mitigated by `ensureColumn` pattern already in use.

- **[API query at member-add time]** Querying the session's last user message introduces an API dependency during `member add` and `join`. If the API is unavailable, agent/model will be `NULL`. -> Acceptable because the join itself also depends on the API for delivery.

- **[Stale agent/model]** If a session's agent/model is changed outside the collab service (e.g., the user switches models in the TUI), the stored member values become stale. -> Acceptable for v1. The collab service cannot observe external model changes without polling, which is out of scope.

- **[Redundant delivery columns]** The `spawn_initial` delivery row still stores agent/model. This is now redundant with the member row. -> Kept intentionally for forensic/debugging value. Can be removed in a future cleanup.
