## MODIFIED Requirements

### Requirement: Collaboration injections are self-contained
Every injected delivery SHALL include room identity, message content or combined batch, current public message when present, and reply instructions rendered from the resolved `collab.reply_instruction` template for the target member.

#### Scenario: Buffered prompt format
- **WHEN** buffered messages are injected
- **THEN** the prompt contains room name, message content, separator, and reply instruction

#### Scenario: Configured reply instruction appears in delivered prompt
- **WHEN** `collab.reply_instruction` is configured and a delivery is injected
- **THEN** the prompt reply guidance is rendered from the configured template with target member variables

#### Scenario: Fallback reply instruction remains available
- **WHEN** no `collab.reply_instruction` is configured and a delivery is injected
- **THEN** the prompt reply guidance uses the built-in fallback template
