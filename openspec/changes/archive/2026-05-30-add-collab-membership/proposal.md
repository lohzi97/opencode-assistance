## Why

Rooms require governed membership before they can carry useful collaboration traffic. This change implements member identity, alias rules, planner-managed membership, and password self-join from PRD lines 82-115 and 482-576.

## What Changes

- Enforce strict lowercase slug aliases, immutable aliases, unique room aliases, and one open room per session.
- Add planner-managed member add/remove, password-based planner self-join, and member leave APIs.
- Enforce open rooms always retaining at least one planner.
- Record system messages and create/cancel pending bootstrap or member deliveries without injecting them yet.

## Capabilities

### New Capabilities
- `collab-membership`: Planner-governed room membership, alias validation, self-join, leave, removal, and member cancellation rules.

### Modified Capabilities
- None.

## Impact

- Extends collab HTTP API and storage usage.
- Depends on room lifecycle and config/state foundations.
