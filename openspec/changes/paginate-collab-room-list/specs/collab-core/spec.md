## ADDED Requirements

### Requirement: Room listings are bounded and cursorable
The system SHALL provide room list responses using bounded newest-first pagination. Room list requests SHALL preserve the existing state filter, support `limit=<n>`, and support `before=<room_id>` as a cursor that returns rooms older than the cursor under the same filter. When `limit` is omitted, the system SHALL apply a default limit. When `limit` exceeds the configured maximum, the system SHALL cap it to that maximum.

#### Scenario: Default room list is bounded
- **WHEN** rooms are listed without an explicit limit
- **THEN** the response includes at most the default page size of rooms ordered by newest first

#### Scenario: Room list honors state filter and limit
- **WHEN** closed rooms are listed with `state=closed` and `limit=2`
- **THEN** the response includes at most two closed rooms ordered by newest first

#### Scenario: Room list honors before cursor
- **WHEN** rooms are listed with `before` set to a room from the first page
- **THEN** the response includes rooms older than that cursor under the selected state filter

#### Scenario: Invalid room list cursor is rejected
- **WHEN** rooms are listed with `before` set to an unknown room id or a room outside the selected state filter
- **THEN** the request is rejected with a clear error and no room page is returned

#### Scenario: Excessive room list limit is capped
- **WHEN** rooms are listed with `limit` greater than the maximum allowed page size
- **THEN** the response includes no more than the maximum allowed page size of rooms
