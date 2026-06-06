## MODIFIED Requirements

### Requirement: Transcripts are visible with delivery annotations
The system SHALL provide bounded room-wide transcript and member-scoped delivery views with delivery state annotations. Transcript reads SHALL support `since=<message_id>` as a forward cursor and `limit=<n>` as a maximum number of messages to return. When `limit` is omitted, the system SHALL apply a default limit. When `limit` exceeds the configured maximum, the system SHALL cap it to that maximum. Results SHALL remain ordered by message creation time ascending with message id as the deterministic tie-breaker.

#### Scenario: Member-scoped messages view
- **WHEN** messages are requested for a member alias
- **THEN** the response shows only messages targeted to that member and each delivery state

#### Scenario: Room messages default page is bounded
- **WHEN** room-wide messages are requested without `limit`
- **THEN** the response includes at most the default page size of messages in chronological order

#### Scenario: Room messages honor cursor and limit
- **WHEN** room-wide messages are requested with `since` set to a message in the room and `limit` set to `2`
- **THEN** the response includes at most two messages strictly after the cursor message in chronological order

#### Scenario: Member messages honor cursor and limit
- **WHEN** member-scoped messages are requested with `since` set to a targeted message and `limit` set to `2`
- **THEN** the response includes at most two targeted messages strictly after the cursor message in chronological order

#### Scenario: Invalid transcript cursor is rejected
- **WHEN** messages are requested with `since` set to a message id that does not belong to the room
- **THEN** the request is rejected with a clear error and no transcript page is returned

#### Scenario: Excessive transcript limit is capped
- **WHEN** messages are requested with `limit` greater than the maximum allowed page size
- **THEN** the response includes no more than the maximum allowed page size of messages
