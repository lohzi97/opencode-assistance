## ADDED Requirements

### Requirement: Spawned session ownership survives compaction handoff
The spawn capability SHALL preserve room ownership for spawned members when their OpenCode session is replaced by a custom compaction continuation session.

#### Scenario: Spawned session record is updated on handoff
- **WHEN** a spawned room member is handed off from `ses_old` to `ses_new`
- **THEN** the `spawned_sessions` record for that room member uses `ses_new` and remains associated with the same room and spawning session

#### Scenario: Non-spawned member handoff does not create spawned ownership
- **WHEN** a non-spawned room member is handed off from `ses_old` to `ses_new`
- **THEN** no new `spawned_sessions` record is created
