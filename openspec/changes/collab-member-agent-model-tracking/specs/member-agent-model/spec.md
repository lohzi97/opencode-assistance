# member-agent-model Specification

## Purpose

Define the capability for tracking and persisting each room member session's effective agent, model provider, model ID, and variant. This ensures that every collab delivery to that session preserves the intended agent/model instead of reverting to system defaults.

## ADDED Requirements

### Requirement: Member row stores effective agent/model/variant
The system SHALL persist optional `agent`, `model_provider_id`, `model_id`, and `model_variant` columns on each member row in the `members` table. These columns MAY be `NULL` when the agent/model cannot be determined at membership time.

#### Scenario: Spawn stores explicit agent and model
- **WHEN** a planner spawns a session with `--agent shalltear --provider deepseek --model deepseek-v4-pro --variant thinking`
- **THEN** the member row stores `agent='shalltear'`, `model_provider_id='deepseek'`, `model_id='deepseek-v4-pro'`, `model_variant='thinking'`

#### Scenario: Spawn stores caller-default agent and model
- **WHEN** a planner spawns a session without explicit agent or model and the planner's last assistant message used agent `sebastian` and model `zai-coding-plan/glm-5.1`
- **THEN** the member row stores `agent='sebastian'`, `model_provider_id='zai-coding-plan'`, `model_id='glm-5.1'`, `model_variant=NULL`

#### Scenario: Member add captures session agent and model
- **WHEN** a planner adds an existing session to a room and that session's last user message used agent `shalltear` and model `google/gemini-2.5-pro`
- **THEN** the member row stores `agent='shalltear'`, `model_provider_id='google'`, `model_id='gemini-2.5-pro'`, `model_variant=NULL`

#### Scenario: Self-join captures session agent and model
- **WHEN** a session self-joins a room with the planner password and that session's last user message used agent `sebastian` and model `zai-coding-plan/glm-5.1`
- **THEN** the member row stores `agent='sebastian'`, `model_provider_id='zai-coding-plan'`, `model_id='glm-5.1'`, `model_variant=NULL`

#### Scenario: Room founder captures session agent and model
- **WHEN** a planner creates a room and the founder session's last user message used agent `sebastian` and model `openai/gpt-5.5`
- **THEN** the founder member row stores `agent='sebastian'`, `model_provider_id='openai'`, `model_id='gpt-5.5'`, `model_variant=NULL`

#### Scenario: Missing session history stores NULL agent and model
- **WHEN** a planner adds an existing session that has no user messages in its history
- **THEN** the member row stores `agent=NULL`, `model_provider_id=NULL`, `model_id=NULL`, `model_variant=NULL`

### Requirement: Member agent/model is used on every delivery
The delivery engine SHALL read the target member's stored `agent`, `model_provider_id`, `model_id`, and `model_variant` and pass them on every `promptAsync` call. When all fields are `NULL`, the delivery engine SHALL omit agent/model from the `promptAsync` call, falling back to OpenCode's default resolution.

#### Scenario: Buffered delivery preserves agent and model
- **WHEN** a member row has `agent='shalltear'` and `model_id='gemini-2.5-pro'` and a buffered delivery is injected
- **THEN** the `promptAsync` call includes `agent='shalltear'` and `model={ providerID: ..., modelID: 'gemini-2.5-pro' }`

#### Scenario: Immediate delivery preserves agent and model
- **WHEN** a member row has `agent='sebastian'` and a mention-triggered immediate delivery is injected
- **THEN** the `promptAsync` call includes `agent='sebastian'`

#### Scenario: Hard delivery preserves agent and model
- **WHEN** a member row has `agent='shalltear'` and a hard delivery is injected
- **THEN** the `promptAsync` call includes `agent='shalltear'`

#### Scenario: Join bootstrap for spawned member preserves agent and model
- **WHEN** a member row has `agent='shalltear'` and a join bootstrap delivery is injected
- **THEN** the `promptAsync` call includes `agent='shalltear'`

#### Scenario: NULL agent/model falls back to defaults
- **WHEN** a member row has all agent/model fields as `NULL` and a delivery is injected
- **THEN** the `promptAsync` call omits agent and model, allowing OpenCode to use its default resolution

### Requirement: Database migration adds agent/model columns to members
The system SHALL add `agent`, `model_provider_id`, `model_id`, and `model_variant` columns to the `members` table via additive migration using the existing `ensureColumn` pattern. Existing member rows SHALL have `NULL` values for all new columns.

#### Scenario: Existing database receives new columns
- **WHEN** the collab service starts with an existing database that lacks agent/model columns
- **THEN** the columns are added without data loss and existing rows have `NULL` values
