## MODIFIED Requirements

### Requirement: Spawn applies agent, model, and directory selection
The spawn operation SHALL use explicit `agent`, `model` (providerID, modelID, variant), and `directory` values when provided, otherwise default from the caller session's last assistant message when available, per PRD lines 603-604. The resolved agent and model SHALL also be stored on the member row for use by the delivery engine.

#### Scenario: Explicit model override
- **WHEN** spawn includes provider, model, and variant ids
- **THEN** the OpenCode session is created with those explicit model values, variant is stored on the delivery row, and the member row stores the same agent/model/variant

#### Scenario: Caller-derived defaults from message history
- **WHEN** spawn omits agent or model
- **THEN** defaults are derived from the planner's last assistant message in session history and stored on the member row

#### Scenario: Spawn stores agent/model on member row
- **WHEN** a planner spawns a session with resolved agent and model
- **THEN** the member row in the `members` table stores the resolved `agent`, `model_provider_id`, `model_id`, and `model_variant` values
