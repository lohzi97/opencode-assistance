# collab-delivery Specification

## Purpose

Define the durable contract for collaboration message delivery execution: buffered delivery, immediate soft delivery, hard interrupt delivery, blocker handling, chronological batching, self-contained prompt injection, and close-drain/failure semantics. This spec assumes core rooms, members, messages, and delivery records exist under `collab-core`.

## Requirements

### Requirement: Buffered delivery waits for eligibility
The engine SHALL block buffered delivery when the target session is `busy`, `retry`, has a pending user question, or has an unresolved collab question while the room is open.

#### Scenario: Busy target blocks buffered backlog
- **WHEN** a target has pending buffered deliveries and session status `busy`
- **THEN** no prompt is injected and deliveries remain `pending`

#### Scenario: Idle eligible target receives backlog
- **WHEN** a target has pending buffered deliveries and no blockers
- **THEN** the full pending backlog is injected in one chronological batch

### Requirement: Join bootstrap precedes later traffic
The engine SHALL deliver the join bootstrap before later room traffic for newly added, spawned, or self-joined members. The join bootstrap content SHALL be rendered from the resolved `collab.room_join_instruction` template with room, alias, role, and from variables, falling back to a built-in room join instruction when not configured.

#### Scenario: Bootstrap before assignment
- **WHEN** a member has a pending bootstrap and a later task message
- **THEN** the injected batch places the bootstrap content before the task message

#### Scenario: Configured room join instruction appears first
- **WHEN** a member is added to a room and `collab.room_join_instruction` is configured
- **THEN** the first injected prompt for that member contains the rendered room join instruction before any normal room message content

#### Scenario: Self-join receives configured room join instruction
- **WHEN** a session joins a room with the planner password and `collab.room_join_instruction` is configured
- **THEN** the first injected prompt for that session contains the rendered room join instruction

### Requirement: Collaboration injections are self-contained
Every injected delivery SHALL include room identity, message content or combined batch, current public message when present, reply instructions rendered from the resolved `collab.reply_instruction` template for the target member, and the target member's stored agent/model/variant passed to `promptAsync`. Join bootstrap deliveries SHALL include the rendered `collab.room_join_instruction` content and SHALL pass the member's stored agent/model/variant. Normal room-message deliveries SHALL render as one compact room transcript per injected prompt, with room-level context and reply guidance appearing once for the whole prompt rather than once per delivered message. Normal message entries SHALL be rendered chronologically as `[<YYYYMMDDHHmmss>|<kind>] <from>:` followed by the message body, where the timestamp is derived from the message creation time using the service timestamp formatter. Normal message prompt text SHALL NOT include delivery mode labels.

#### Scenario: Single buffered prompt format
- **WHEN** one buffered room message is injected
- **THEN** the prompt contains one room header, the message content as one timestamped sender/kind entry under `[Message]`, a separator, and one reply instruction, and the `promptAsync` call includes the member's stored agent/model/variant

#### Scenario: Combined buffered prompt format avoids repeated room context
- **WHEN** multiple buffered room messages are injected in one chronological batch and a room public message is present
- **THEN** the prompt contains the room name once, the public message once, one `[Message]` block, one chronological timestamped entry per delivered message, and one reply instruction at the end, and the `promptAsync` call includes the member's stored agent/model/variant

#### Scenario: Delivery mode is omitted from normal prompt text
- **WHEN** buffered, immediate, or hard normal room messages are injected
- **THEN** the prompt text does not include `Delivery: buffered`, `Delivery: immediate`, or `Delivery: hard`

#### Scenario: Configured reply instruction appears once in combined prompt
- **WHEN** `collab.reply_instruction` is configured and multiple normal room messages are injected in one prompt
- **THEN** the prompt reply guidance is rendered once from the configured template with target member variables

#### Scenario: Fallback reply instruction remains available
- **WHEN** no `collab.reply_instruction` is configured and a delivery is injected
- **THEN** the prompt reply guidance uses the built-in fallback template

#### Scenario: Join bootstrap remains first in mixed prompt
- **WHEN** a target receives a join bootstrap and later normal room traffic in the same injected prompt
- **THEN** the bootstrap onboarding content appears before the normal `[Message]` transcript and the resolved reply instruction appears once at the end of the prompt, and the `promptAsync` call includes the member's stored agent/model/variant

#### Scenario: Join bootstrap uses configured room join content
- **WHEN** `collab.room_join_instruction` is configured and a join bootstrap is injected
- **THEN** the prompt contains the rendered room join instruction exactly as the bootstrap content, without appending the built-in fallback text

### Requirement: Immediate soft delivery respects soft blockers
The engine SHALL deliver immediate messages during `busy` but SHALL block them during pending user question or `retry`.

#### Scenario: Busy target receives immediate message
- **WHEN** a target is `busy` with no pending user question and has an immediate delivery
- **THEN** the engine injects the message

#### Scenario: Retry target blocks immediate message
- **WHEN** a target is in `retry`
- **THEN** immediate delivery remains pending

### Requirement: Immediate delivery preserves older buffered context
If an immediate message is newer than pending buffered deliveries for the same target, the engine SHALL inject one chronological batch containing older buffered items first and the immediate item last.

#### Scenario: Buffered backlog before immediate mention
- **WHEN** a target has an older buffered message and a newer immediate mention
- **THEN** one prompt is injected with the buffered message before the immediate message

### Requirement: Message kind does not change urgency
The system SHALL determine immediate urgency from mentions and hard flag only, not from `kind`.

#### Scenario: Task assignment without mention is buffered
- **WHEN** a member sends a `task_assignment` message without mentions
- **THEN** delivery records are buffered, not immediate

### Requirement: Hard interrupt is planner-only and strictly validated
The system SHALL allow hard delivery only from an active planner in an open room to active non-self targets after normal mention validation passes.

#### Scenario: Non-planner hard rejected
- **WHEN** a non-planner sends a message with `hard: true`
- **THEN** the operation is rejected and no abort is attempted

#### Scenario: Self-target hard rejected
- **WHEN** a planner hard-targets itself
- **THEN** the operation is rejected before delivery records are created

### Requirement: Multi-target hard delivery is all-or-nothing
The engine SHALL abort all targeted sessions, wait for all to become idle, inject to none if any wait fails, and mark all targeted deliveries failed on barrier failure.

#### Scenario: One target fails idle wait
- **WHEN** one target does not become idle before timeout
- **THEN** no target receives the hard prompt and all hard delivery records for the message are marked failed

### Requirement: Hard delivery preserves chronological context
If a hard message is newer than older pending buffered records for the same target, the engine SHALL inject one chronological batch with older buffered items first and the hard message last. The `promptAsync` call SHALL include the target member's stored agent/model/variant.

#### Scenario: Hard follows buffered backlog
- **WHEN** a target has older buffered messages and a newer hard message
- **THEN** the injected prompt preserves that chronological order after the hard wait succeeds and the `promptAsync` call includes the member's stored agent/model/variant

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

### Requirement: Closed rooms reject new mutations but drain existing backlog
After close, the system SHALL reject new send, ask, answer, join, leave, member add/remove, spawn, and public-message mutations while allowing already-created deliveries and the closure message to drain, per PRD lines 850-870.

#### Scenario: Mutation after close rejected
- **WHEN** a member sends a new message after room closure
- **THEN** the operation is rejected and no message or delivery record is created

#### Scenario: Existing backlog drains after close
- **WHEN** buffered deliveries existed before close and the target later becomes eligible
- **THEN** those deliveries and the closure message drain chronologically

### Requirement: Close drain adjusts blockers correctly
During close drain, unresolved collab questions SHALL be cancelled and SHALL NOT block final buffered delivery, while busy, retry, and pending user-question blockers still apply, per PRD lines 867-870.

#### Scenario: Unanswered collab question does not block close drain
- **WHEN** a closed room has an unresolved collab question and pending buffered backlog
- **THEN** the backlog may drain once other session blockers are clear

#### Scenario: Room close cancels unresolved question targets
- **WHEN** a room is closed with unresolved collab question targets
- **THEN** those question targets are marked cancelled with a room-closure reason

### Requirement: Existing hard deliveries may drain after close
Hard delivery records created before room close SHALL be allowed to execute during close drain without reapplying the open-room precondition, while preserving hard interrupt validation, wait, and failure semantics.

#### Scenario: Pre-close hard delivery drains after close
- **WHEN** a hard delivery was created before room closure and remains pending during close drain
- **THEN** the engine may execute it without rejecting it solely because the room is closed

### Requirement: Delivery failures are retried or surfaced
The engine SHALL retry transient transport/backend failures, not retry validation failures, allow pre-close pending deliveries to retry after close, and surface permanent failures in status and message views per PRD lines 872-879.

#### Scenario: Permanent failure visible in status
- **WHEN** a delivery fails with a validation error
- **THEN** it is marked failed and appears in room status outstanding failure data
