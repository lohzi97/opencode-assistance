## ADDED Requirements

### Requirement: Paused rooms suppress delivery and inactivity work
The delivery engine SHALL NOT flush pending deliveries for paused rooms and SHALL NOT create inactivity notices for paused rooms. Pending deliveries and pending question targets SHALL remain pending while a room is paused unless another explicit lifecycle operation changes them.

#### Scenario: Pending delivery remains pending while paused
- **WHEN** a room is paused and a target has pending buffered, immediate, hard, bootstrap, or handoff reminder deliveries
- **THEN** the delivery tick does not inject those deliveries and they remain `pending`

#### Scenario: Paused inactive room has no inactivity notice
- **WHEN** a paused room has no meaningful activity longer than the configured inactivity threshold
- **THEN** the delivery tick does not create an `inactivity_notice` message or planner delivery

### Requirement: Resume prompts interrupted members
When a paused room is resumed, the service SHALL inject a dedicated administrative resume prompt into every active member recorded as interrupted by the latest pause and SHALL use the member's stored directory, agent, model, and variant routing options. The resume prompt SHALL identify the room and instruct the member to continue its prior task. Members that were not interrupted by the pause SHALL NOT receive the administrative resume prompt.

#### Scenario: Interrupted member receives resume prompt
- **WHEN** a paused room is resumed and an active member was recorded as interrupted by the latest pause
- **THEN** the service calls `promptAsync` for that member with a resume prompt and the member's stored routing options

#### Scenario: Non-interrupted member receives no resume prompt
- **WHEN** a paused room is resumed and an active member was not interrupted by the latest pause
- **THEN** no administrative resume prompt is injected for that member

#### Scenario: Resume prompt failure is recorded
- **WHEN** injecting the administrative resume prompt for an interrupted member fails
- **THEN** the failure is recorded for status diagnostics and normal pending deliveries to that member remain gated

### Requirement: Interrupted members are gated until resume turn completes
After resume prompt injection, normal pending deliveries for an interrupted member SHALL remain blocked until the service observes the member session become `busy` or `retry` after the resume prompt and then later become `idle`. Once that busy-then-idle sequence is observed, the resume gate SHALL clear and pending deliveries SHALL follow normal delivery blockers and chronological batching rules.

#### Scenario: Pending deliveries do not overtake resume prompt
- **WHEN** a room is resumed and an interrupted member has pending room deliveries
- **THEN** those room deliveries are not injected immediately after the resume prompt solely because the room state is `open`

#### Scenario: Gate clears after busy then idle
- **WHEN** an interrupted member receives a resume prompt, is later observed `busy`, and then is observed `idle`
- **THEN** the resume gate clears and eligible pending deliveries may flush according to normal delivery rules

#### Scenario: Gate remains before busy observation
- **WHEN** an interrupted member receives a resume prompt but the service has not observed a post-resume `busy` or `retry` state
- **THEN** normal pending deliveries to that member remain pending even if the current status appears `idle`

### Requirement: Non-interrupted members resume normal delivery immediately
After a paused room is resumed, active members that were not interrupted by the latest pause SHALL be eligible for normal pending delivery flushing immediately, subject to the existing delivery blockers for each delivery mode.

#### Scenario: Idle non-interrupted member receives pending backlog
- **WHEN** a paused room is resumed and a non-interrupted member is idle with pending buffered deliveries
- **THEN** the delivery engine may inject the pending backlog on the next delivery flush

#### Scenario: Busy non-interrupted member follows existing blockers
- **WHEN** a paused room is resumed and a non-interrupted member is busy with pending buffered deliveries
- **THEN** buffered deliveries remain pending until existing buffered delivery blockers clear
