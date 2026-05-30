# E2E Issues

## MEDIUM: Spawn `directory` input is not applied to the created OpenCode session

**Status:** RESOLVED. Fix verified during E2E re-test on 20260529.

**Original Issue:** Per `openspec/changes/add-collab-spawn/specs/collab-spawn/spec.md`, requirement "Spawn applies agent, model, and directory selection", a spawn request with an explicit `directory` should create the OpenCode session using that directory. The spawn request succeeded, but the created OpenCode session used the workspace directory instead of the explicit `directory` value.

**Root Cause:** `CollabService.spawnMember()` read `directory` into the `spawn` object but called `createSpawnSession({ title })` without passing the directory value. Additionally, `OpenCodeClient.createSpawnSession()` did not forward directory to the OpenCode `/session` endpoint.

**Fix Applied:** `collab.ts` now passes `directory: spawn.directory` to `createSpawnSession`. `shared.ts` `createSpawnSession()` now sends directory as a URL query parameter (`?directory=...`) which OpenCode's `InstanceMiddleware` handles natively.

**Re-test Evidence (20260529):**

- Unit tests: 5 spawn-related tests pass (including `directory: "/tmp/spawn"` assertion at `collab.test.ts:1043`).
- Live E2E T1 — Spawn with explicit directory `/tmp/opencode/collab-spawn-e2e-dir`: session `ses_18ba913caffeebB01hIi0NmTaF` created with `directory="/tmp/opencode/collab-spawn-e2e-dir"`. PASS.
- Live E2E T2 — Spawn without directory: session `ses_18ba913ca47ffexXIl0H1l2BZUJB` created with default `directory="/home/lohzi/Projects/opencode-assistant"`. PASS.
- Direct API test: `POST /session?directory=/tmp/opencode/collab-spawn-e2e-dir` returns `directory="/tmp/opencode/collab-spawn-e2e-dir"`. PASS.
