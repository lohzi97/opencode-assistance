## ADDED Requirements

### Requirement: Delivery tick creates due planner inactivity notices
The delivery engine SHALL evaluate open rooms for inactivity during the existing delivery tick. A room qualifies when inactivity nudges are enabled, the room is open, meaningful activity has been absent for at least `threshold_ms`, and no inactivity notice has been created within `repeat_ms` since the later of the last meaningful activity and the previous inactivity notice.

#### Scenario: Open inactive room creates notice
- **WHEN** an open room has no meaningful activity for longer than the configured threshold and has an active planner
- **THEN** the delivery tick creates one `inactivity_notice` message and pending immediate deliveries for active planners

#### Scenario: Recent meaningful activity suppresses notice
- **WHEN** an open room has meaningful member or system activity newer than the inactivity threshold
- **THEN** the delivery tick does not create an inactivity notice

#### Scenario: Recent inactivity notice is rate limited
- **WHEN** an open inactive room already received an inactivity notice within the configured repeat interval
- **THEN** the delivery tick does not create another inactivity notice

#### Scenario: Closed room is ignored
- **WHEN** a closed room has no meaningful activity for longer than the configured threshold
- **THEN** the delivery tick does not create any new inactivity notice or delivery

### Requirement: Inactivity notices target active planners only
Inactivity notice deliveries SHALL target active room members whose role is `planner` and SHALL NOT target non-planner members by default. The delivery mode SHALL be immediate soft and SHALL use the target planner member's stored agent/model/variant options when calling `promptAsync`.

#### Scenario: Multiple planners receive notice
- **WHEN** an inactive room has two active planners and one implementer
- **THEN** pending immediate deliveries are created for both planners and no delivery is created for the implementer

#### Scenario: Removed planner is not targeted
- **WHEN** an inactive room has a removed planner and an active planner
- **THEN** the inactivity notice targets only the active planner

#### Scenario: Planner delivery preserves route options
- **WHEN** an inactivity notice is injected to a planner with stored agent/model/variant fields
- **THEN** the `promptAsync` call includes those stored routing options

### Requirement: Inactivity notice injection follows immediate soft blockers
Inactivity notice deliveries SHALL follow existing immediate soft delivery blockers: delivery is allowed while the target session is `busy`, blocked during pending user question, and blocked during `retry`. Once blockers clear, the notice SHALL drain through the normal pending delivery path.

#### Scenario: Busy planner receives inactivity notice
- **WHEN** a planner target is `busy` with no pending user question and has a pending inactivity notice delivery
- **THEN** the engine injects the inactivity notice prompt

#### Scenario: Retry planner blocks inactivity notice
- **WHEN** a planner target is in `retry` and has a pending inactivity notice delivery
- **THEN** the inactivity notice delivery remains pending

#### Scenario: Pending user question blocks inactivity notice
- **WHEN** a planner target has a pending user question and has a pending inactivity notice delivery
- **THEN** the inactivity notice delivery remains pending

### Requirement: Inactivity notice prompt is self-contained
An injected inactivity notice SHALL render as a self-contained collaboration prompt containing room identity, current room public message when present, the inactivity notice message body, and the resolved reply instruction for the target planner. The prompt SHALL make clear that the planner may send a reminder, ask for status, close the room, or take no action if silence is intentional.

#### Scenario: Inactivity prompt includes room context
- **WHEN** an inactivity notice is injected for a room with a public message
- **THEN** the prompt contains the room name, the current public message, the inactivity notice body, and one reply instruction

#### Scenario: Inactivity prompt suggests planner actions
- **WHEN** the built-in inactivity notice message is used
- **THEN** the injected prompt tells the planner to consider sending a reminder, asking for status, closing the room, or doing nothing if the silence is expected
