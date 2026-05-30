# collab-public-message Specification

## Purpose

Define the planner-owned room public message contract for collaboration rooms: set/clear authorization, update notifications, and inclusion in future collaboration deliveries. This capability is optional shared room context layered on top of `collab-core` and `collab-delivery`.

## Requirements

### Requirement: Only planners manage the public message
The system SHALL allow only active planners to set, replace, or clear the room public message while the room is open, per PRD lines 447-481.

#### Scenario: Planner sets public message
- **WHEN** an active planner sets a public message body
- **THEN** the room stores the full replacement body, updater alias, update timestamp, and a `room_public_message_updated` transcript message

#### Scenario: Non-planner update rejected
- **WHEN** a non-planner attempts to set or clear the public message
- **THEN** the operation is rejected and the stored public message is unchanged

### Requirement: Public-message changes notify other members immediately
Setting or clearing the public message SHALL emit immediate soft deliveries to all other active members, injecting the full latest public message for updates and a clear notification for clears, per PRD lines 125-128 and 467-480.

#### Scenario: Update notification excludes updater
- **WHEN** a planner updates the public message
- **THEN** immediate delivery records are created for all other active members and not for the planner sender

### Requirement: Current public message appears in future injections
Every future collaboration delivery SHALL include the latest room public message when present, as required by PRD lines 128 and 743-748.

#### Scenario: Later buffered delivery includes public message
- **WHEN** a public message exists and a later buffered message is injected
- **THEN** the prompt contains the public-message section with the latest text
