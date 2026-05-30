## MODIFIED Requirements

### Requirement: Join bootstrap precedes later traffic
The engine SHALL deliver the join bootstrap before later room traffic for newly added, spawned, or self-joined members. The join bootstrap content SHALL be rendered from the resolved `collab.room_join_instruction` template with room, alias, role, and from variables, falling back to a built-in room join instruction when not configured.

#### Scenario: Bootstrap before assignment
- **WHEN** a member has a pending bootstrap and a later task message
- **THEN** the injected batch places the bootstrap content before the task message

#### Scenario: Configured room join instruction appears first
- **WHEN** a member is added to a room and `collab.room_join_instruction` is configured
- **THEN** the first injected prompt for that member contains the rendered room join instruction before any normal room message content

#### Scenario: Self-join receives configured room join instruction
- **WHEN** a session joins a room with the planner password and `collab.room_join_instruction` is configured
- **THEN** the first injected prompt for that session contains the rendered room join instruction

### Requirement: Collaboration injections are self-contained
Every injected delivery SHALL include room identity, message content or combined batch, current public message when present, and reply instructions rendered from the resolved `collab.reply_instruction` template for the target member. Join bootstrap deliveries SHALL include the rendered `collab.room_join_instruction` content. Normal room-message deliveries SHALL render as one compact room transcript per injected prompt, with room-level context and reply guidance appearing once for the whole prompt rather than once per delivered message. Normal message entries SHALL be rendered chronologically as `[<YYYYMMDDHHmmss>|<kind>] <from>:` followed by the message body, where the timestamp is derived from the message creation time using the service timestamp formatter. Normal message prompt text SHALL NOT include delivery mode labels.

#### Scenario: Single buffered prompt format
- **WHEN** one buffered room message is injected
- **THEN** the prompt contains one room header, the message content as one timestamped sender/kind entry under `[Message]`, a separator, and one reply instruction

#### Scenario: Combined buffered prompt format avoids repeated room context
- **WHEN** multiple buffered room messages are injected in one chronological batch and a room public message is present
- **THEN** the prompt contains the room name once, the public message once, one `[Message]` block, one chronological timestamped entry per delivered message, and one reply instruction at the end

#### Scenario: Delivery mode is omitted from normal prompt text
- **WHEN** buffered, immediate, or hard normal room messages are injected
- **THEN** the prompt text does not include `Delivery: buffered`, `Delivery: immediate`, or `Delivery: hard`

#### Scenario: Configured reply instruction appears once in combined prompt
- **WHEN** `collab.reply_instruction` is configured and multiple normal room messages are injected in one prompt
- **THEN** the prompt reply guidance is rendered once from the configured template with target member variables

#### Scenario: Fallback reply instruction remains available
- **WHEN** no `collab.reply_instruction` is configured and a delivery is injected
- **THEN** the prompt reply guidance uses the built-in fallback template

#### Scenario: Join bootstrap remains first in mixed prompt
- **WHEN** a target receives a join bootstrap and later normal room traffic in the same injected prompt
- **THEN** the bootstrap onboarding content appears before the normal `[Message]` transcript and the resolved reply instruction appears once at the end of the prompt

#### Scenario: Join bootstrap uses configured room join content
- **WHEN** `collab.room_join_instruction` is configured and a join bootstrap is injected
- **THEN** the prompt contains the rendered room join instruction exactly as the bootstrap content, without appending the built-in fallback text
