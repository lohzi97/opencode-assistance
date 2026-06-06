## ADDED Requirements

### Requirement: Inactivity nudge configuration loads safely
The worker SHALL load optional `collab.inactivity_nudge` configuration with disabled-safe defaults, validating that `threshold_ms` and `repeat_ms` are positive when inactivity nudges are enabled. The inactivity nudge message SHALL support built-in fallback content and optional configured text or file content using the same instruction-source style as existing collaboration templates.

#### Scenario: Default inactivity nudge configuration
- **WHEN** the worker starts without `collab.inactivity_nudge` configuration
- **THEN** collab startup succeeds and inactivity nudges use the built-in default policy

#### Scenario: Invalid inactivity threshold rejected
- **WHEN** inactivity nudges are enabled with `threshold_ms` less than or equal to zero
- **THEN** configuration validation fails with a clear error

#### Scenario: Configured inactivity message replaces fallback
- **WHEN** `collab.inactivity_nudge.message` is configured from text or file
- **THEN** inactivity notice prompts use the configured template instead of the built-in fallback

### Requirement: Room status exposes inactivity metadata
Room status SHALL expose inactivity metadata for every room: `last_meaningful_activity_at`, `last_inactivity_nudge_at`, `inactive_for_ms`, and `next_inactivity_nudge_at`. `last_meaningful_activity_at` SHALL be calculated from room messages excluding `inactivity_notice` messages, and `last_inactivity_nudge_at` SHALL be tracked separately.

#### Scenario: Status for active room with member activity
- **WHEN** status is requested for an open room with at least one non-`inactivity_notice` message
- **THEN** the response includes the latest meaningful activity timestamp and computed inactivity duration

#### Scenario: Inactivity notices do not reset meaningful activity
- **WHEN** an `inactivity_notice` message is the newest room message
- **THEN** `last_meaningful_activity_at` remains the timestamp of the latest non-`inactivity_notice` message

#### Scenario: Next nudge timestamp shown when rate limited
- **WHEN** a room has already received an inactivity notice and no later meaningful activity occurred
- **THEN** status includes `last_inactivity_nudge_at` and `next_inactivity_nudge_at` based on the configured repeat interval

### Requirement: Inactivity notices are system-authored transcript entries
The system SHALL persist inactivity nudges as system-authored room messages with kind `inactivity_notice`, sender name `system`, and body rendered from the resolved inactivity message template. These messages SHALL remain visible through transcript APIs but SHALL NOT count as meaningful room activity.

#### Scenario: Inactivity notice is persisted
- **WHEN** an open room qualifies for an inactivity nudge
- **THEN** a system message with kind `inactivity_notice` is stored in that room transcript

#### Scenario: Transcript includes inactivity notice kind
- **WHEN** room messages are requested after an inactivity notice is created
- **THEN** the notice appears with sender `system` and kind `inactivity_notice`
