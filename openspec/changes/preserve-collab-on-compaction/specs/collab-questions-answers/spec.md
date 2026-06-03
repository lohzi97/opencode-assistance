## ADDED Requirements

### Requirement: Pending question targets follow compaction session handoff
The question workflow SHALL retarget unresolved question targets for a handed-off member from the superseded session id to the continuation session id.

#### Scenario: Pending question can be answered after handoff
- **WHEN** a member has a pending collab question target on `ses_old` and custom compaction hands the member off to `ses_new`
- **THEN** the pending question target uses `ses_new` and an answer from `ses_new` with the same alias is accepted

#### Scenario: Old session cannot answer after handoff
- **WHEN** a pending question target has been retargeted from `ses_old` to `ses_new`
- **THEN** an answer from `ses_old` with the handed-off alias is rejected

#### Scenario: Buffered blocker follows continuation session
- **WHEN** a member has an unresolved collab question retargeted from `ses_old` to `ses_new`
- **THEN** buffered delivery remains blocked for `ses_new` until the question is answered or cancelled
