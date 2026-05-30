## MODIFIED Requirements

### Requirement: Instruction templates resolve predictably
The service SHALL load `spawn_instruction` and `reply_instruction` from either text or file config, with built-in fallback templates and no merge behavior. The resolved `reply_instruction` SHALL be used wherever collaboration prompt reply guidance is rendered.

#### Scenario: Configured file replaces fallback
- **WHEN** a template file is configured
- **THEN** its content fully replaces the built-in fallback template

#### Scenario: Configured reply instruction is operational
- **WHEN** `collab.reply_instruction` is configured
- **THEN** collaboration prompt reply guidance uses that configured template instead of the built-in fallback
