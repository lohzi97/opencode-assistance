## Issues Found During E2E Testing

### 1. `project_dir` not echoed in room creation response

**Status:** RESOLVED on 20260529 by E2E retest.

**Severity:** LOW (cosmetic API inconsistency)

**Description:** When creating a room with `project_dir`, the value is stored in the database and returned by `GET /room/:id/status`, but is **not** included in the `POST /room` 201 response body. This is a pre-existing room-lifecycle concern, not introduced by the membership change.

**How to reproduce:**

```bash
# Start the collab service (requires a running OpenCode backend or mock)
# Then run:

curl -s -X POST http://127.0.0.1:<port>/room \
  -H 'content-type: application/json' \
  -d '{"name":"test-room","session_id":"ses_1","from":"planner","project_dir":"/tmp/project"}' \
  | jq '.'

# Expected: response body includes "project_dir": "/tmp/project"
# Actual:   response body has no "project_dir" key

# Verify the value IS stored correctly:
curl -s http://127.0.0.1:<port>/room/<room_id>/status | jq '.project_dir'
# Returns: "/tmp/project"
```

**Root cause:** The `createRoom` method in `collab.ts` returns a hardcoded set of fields that omits `project_dir`, while the `publicRoom` helper (used by status/list) includes it.

**Affected code:**

- `.opencode/server/collab.ts` -- `createRoom()` return block (lines ~277-289) does not include `project_dir`
- `.opencode/server/collab.ts` -- `publicRoom()` helper (lines ~1173-1187) does include `project_dir`
