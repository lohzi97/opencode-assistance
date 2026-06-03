## MODIFIED Requirements

### Requirement: Room inspection never exposes password data
Room status and list responses SHALL NOT include planner passwords or password hashes. Room status responses SHALL include room identity, state, public-message fields, active members, `outstanding_failure_count`, and a bounded `outstanding_failures` diagnostic sample. The failure sample SHALL use a default limit when no explicit failure limit is supplied and SHALL cap explicit failure limits at the maximum allowed sample size.

#### Scenario: Status after room creation
- **WHEN** status is requested for a room
- **THEN** the response includes room identity, state, public-message fields, and active members without password fields

#### Scenario: Status failure sample is bounded by default
- **WHEN** status is requested for a room with more failed deliveries than the default failure sample size
- **THEN** `outstanding_failure_count` reports the total number of failed deliveries and `outstanding_failures` includes no more than the default sample size

#### Scenario: Status failure sample honors explicit limit
- **WHEN** status is requested with `failure_limit=5`
- **THEN** `outstanding_failures` includes no more than five failed deliveries and `outstanding_failure_count` still reports the total number of failed deliveries

#### Scenario: Excessive status failure limit is capped
- **WHEN** status is requested with `failure_limit` greater than the maximum allowed sample size
- **THEN** `outstanding_failures` includes no more than the maximum allowed sample size

#### Scenario: Status failure sample exposes recent diagnostics
- **WHEN** status includes a bounded failure sample
- **THEN** the sample is ordered by newest failed delivery first with deterministic tie-breaking
