## Context

Room status calls currently use `publicRoom(...)`, which includes `outstanding_failures` from `failedDeliveriesForRoom(...)`. That helper loads all failed deliveries for the room. Unlike transcripts, status does not need a full historical list; it needs enough failure detail for diagnosis plus a count to indicate severity.

## Goals / Non-Goals

**Goals:**

- Keep room status compact by default.
- Report total outstanding failure count separately from the bounded failure sample.
- Allow callers to request a larger failure sample within a maximum cap.
- Avoid changing member state, room lifecycle, or delivery retry semantics.

**Non-Goals:**

- Implement full cursor pagination for failures.
- Add a dedicated failed-delivery endpoint.
- Change how deliveries become failed, retryable, or cancelled.
- Remove failure details from status entirely.

## Decisions

- Add `outstanding_failure_count` and keep `outstanding_failures` as a bounded array. This preserves useful diagnostics while making truncation explicit.
- Use `failure_limit=<n>` as the optional query parameter for status. This avoids overloading generic `limit`, because status has only one bounded subcollection.
- Default the failure sample to `20` and cap explicit values at `100`. Status should remain concise even under failure storms.
- Return newest failures first. Recent failures are more useful in status diagnostics than oldest historical failures.
- Apply the same bounded public-room representation to room list unless a future change introduces a lighter list item shape.

## Risks / Trade-offs

- Some callers may have relied on status returning every failed delivery -> mitigate with `outstanding_failure_count` and explicit `failure_limit` up to the cap.
- Newest-first failure ordering differs from the current oldest-first helper -> mitigate by documenting it as diagnostic sample behavior.
- Room list entries may still spend work computing counts -> acceptable for now; room-list pagination limits the number of rooms inspected per response.
