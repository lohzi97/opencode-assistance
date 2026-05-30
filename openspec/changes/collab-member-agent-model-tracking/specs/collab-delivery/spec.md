## MODIFIED Requirements

### Requirement: Collaboration injections are self-contained
Every injected delivery SHALL include room identity, message content or combined batch, current public message when present, reply instructions rendered from the resolved `collab.reply_instruction` template for the target member, and the target member's stored agent/model/variant passed to `promptAsync`. Join bootstrap deliveries SHALL include the rendered `collab.room_join_instruction` content and SHALL pass the member's stored agent/model/variant. Normal room-message deliveries SHALL render as one compact room transcript per injected prompt, with room-level context and reply guidance appearing once for the whole prompt rather than once per delivered message. Normal message entries SHALL be rendered chronologically as `[<YYYYMMDDHHmmss>|<kind>] <from>:` followed by the message body, where the timestamp is derived from the message creation time using the service timestamp formatter. Normal message prompt text SHALL NOT include delivery mode labels.

#### Scenario: Single buffered prompt format
- **WHEN** one buffered room message is injected
- **THEN** the prompt contains one room header, the message content as one timestamped sender/kind entry under `[Message]`, a separator, and one reply instruction, and the `promptAsync` call includes the member's stored agent/model/variant

#### Scenario: Combined buffered prompt format avoids repeated room context
- **WHEN** multiple buffered room messages are injected in one chronological batch and a room public message is present
- **THEN** the prompt contains the room name once, the public message once, one `[Message]` block, one chronological timestamped entry per delivered message, and one reply instruction at the end, and the `promptAsync` call includes the member's stored agent/model/variant

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
- **THEN** the bootstrap onboarding content appears before the normal `[Message]` transcript and the resolved reply instruction appears once at the end of the prompt, and the `promptAsync` call includes the member's stored agent/model/variant

#### Scenario: Join bootstrap uses configured room join content
- **WHEN** `collab.room_join_instruction` is configured and a join bootstrap is injected
- **THEN** the prompt contains the rendered room join instruction exactly as the bootstrap content, without appending the built-in fallback text

### Requirement: Hard delivery preserves chronological context
If a hard message is newer than older pending buffered records for the same target, the engine SHALL inject one chronological batch with older buffered items first and the hard message last. The `promptAsync` call SHALL include the target member's stored agent/model/variant.

#### Scenario: Hard follows buffered backlog
- **WHEN** a target has older buffered messages and a newer hard message
- **THEN** the injected prompt preserves that chronological order after the hard wait succeeds and the `promptAsync` call includes the member's stored agent/model/variant
