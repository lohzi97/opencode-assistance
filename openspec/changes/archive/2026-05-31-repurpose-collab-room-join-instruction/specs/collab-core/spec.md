## MODIFIED Requirements

### Requirement: Instruction templates resolve predictably
The service SHALL load `room_join_instruction` and `reply_instruction` from either text or file config, with built-in fallback templates and no merge behavior. The resolved `room_join_instruction` SHALL be used for join bootstrap content, and the resolved `reply_instruction` SHALL be used wherever collaboration prompt reply guidance is rendered.

#### Scenario: Configured file replaces fallback
- **WHEN** a template file is configured
- **THEN** its content fully replaces the built-in fallback template

#### Scenario: Configured reply instruction is operational
- **WHEN** `collab.reply_instruction` is configured
- **THEN** collaboration prompt reply guidance uses that configured template instead of the built-in fallback

#### Scenario: Configured room join instruction is operational
- **WHEN** `collab.room_join_instruction` is configured
- **THEN** join bootstrap content uses that configured template instead of the built-in fallback

#### Scenario: Legacy spawn instruction is not a room join template
- **WHEN** only `collab.spawn_instruction` is configured
- **THEN** the service does not use it as the join bootstrap template

## REMOVED Requirements

### Requirement: Spawn instruction configures join behavior
**Reason**: `spawn_instruction` was ambiguous and only applied to spawned sessions after the join bootstrap, which did not match the intended room-join customization point.
**Migration**: Use `collab.room_join_instruction` with the same `{room}`, `{alias}`, `{role}`, and `{from}` template variables.
