## Why

`GET /room/:room/status` is intended to be a compact room health summary, but it currently includes every failed delivery through `outstanding_failures`. A room with many failed deliveries can make status responses large even when callers only need the current state and a small diagnostic sample.

## What Changes

- Bound the `outstanding_failures` array returned by room status and room public representations.
- Add `outstanding_failure_count` so callers can tell whether the bounded sample is incomplete.
- Support an optional failure sample limit with a safe default and maximum cap.
- Preserve active member and room identity fields.
- Extend the CLI room status command to forward the optional failure limit while remaining a thin wrapper.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: Room inspection requirements now specify bounded outstanding failure samples and total failure count.
- `collab-cli`: `room status` can forward a failure sample limit to the server.

## Impact

- Affected code: `.opencode/server/collab.ts`, `.opencode/server/collab.test.ts`, `.opencode/scripts/agent-collab.ts`, and `.opencode/scripts/agent-collab.test.ts`.
- Affected APIs: `GET /room/:room/status` and any room public representation that includes outstanding failures, including `GET /room/list` entries if they continue to use the same public room shape.
- No new dependencies or storage migrations are expected.
