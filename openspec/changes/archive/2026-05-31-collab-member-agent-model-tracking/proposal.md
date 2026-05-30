## Why

When the collab service delivers messages to room member sessions via `promptAsync`, it does not pass `agent`, `model`, or `variant`. OpenCode's `prompt_async` endpoint resolves a missing `agent` field to the system default agent (not the session's last agent), and resolves a missing `model` to the default agent's configured model (not the session's last model). This causes every collab message delivery to silently reset the target session's agent and model to system defaults, breaking the planner's intent when spawning sessions with specific agents or models.

## What Changes

- The `members` table gains optional columns (`agent`, `model_provider_id`, `model_id`, `model_variant`) to persist each member session's effective agent/model/variant.
- The `room create` founder auto-join path stores the founder session's current agent/model/variant on the member row.
- The `spawn` endpoint stores the spawn-time agent/model/variant on the member row.
- The `member add` and `join` endpoints query the target session's last user message to capture its effective agent/model/variant at join time.
- The delivery engine passes the member's stored agent/model/variant on every `promptAsync` call, not only on `spawn_initial` deliveries.
- The existing `promptOptions()` method is replaced with a member-lookup approach instead of scanning delivery rows for `spawn_initial`.

## Capabilities

### New Capabilities

- `member-agent-model`: Tracks and persists each room member session's agent, model provider, model ID, and variant. Ensures every collab delivery to that session preserves the intended agent/model instead of reverting to system defaults.

### Modified Capabilities

- `collab-spawn`: The `spawn` endpoint now writes agent/model/variant to the member row (not just the `spawn_initial` delivery row).
- `collab-delivery`: The delivery engine reads agent/model/variant from the member row and passes it on every `promptAsync` call, replacing the current `spawn_initial`-only `promptOptions()` approach.
- `collab-core`: The `member add` and `join` endpoints capture the target session's current agent/model/variant from the OpenCode API.

## Impact

- **Storage**: `members` table gains 4 new nullable columns via migration (`agent`, `model_provider_id`, `model_id`, `model_variant`).
- **API**: No new endpoints. Existing `spawn`, `member add`, and `join` endpoints gain internal side effects (member row writes). No breaking API changes.
- **CLI**: No CLI changes required. Agent/model/variant tracking is fully internal.
- **Delivery engine**: `promptOptions()` logic changes from delivery-row scanning to member-row lookup.
- **Tests**: New unit tests for member agent/model capture. Existing delivery tests need updated assertions verifying agent/model on every `promptAsync` call.
