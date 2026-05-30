# E2E Testing Issues

Last tested: 20260530

## ~~HIGH: Pre-close hard delivery fails during closed-room drain when target status is absent~~ — FIXED

### What Happened

A hard delivery created before room close was attempted during closed-room drain, but it was marked `failed` with `hard idle wait timed out` instead of being injected. The target session was a freshly-created real OpenCode session with no `/session/status` entry before the test. Normal buffered/closure delivery later treated the same session as eligible and injected successfully.

### Root Cause

`waitForHardTargetsIdle` in `collab.ts` treated an absent `sessionStatus` entry (`undefined`) as non-idle, unlike buffered delivery blockers where `undefined` status is eligible.

### Fix

Line 504 of `collab.ts` changed from treating absent status as blocked to explicitly checking `status !== undefined && status.type !== "idle"` — absent status is now treated as idle.

### Retest Results (20260530)

E2E retest using the exact reproduction steps (mock client with empty `sessionStatus`, buffered + hard messages before close, `tickDelivery()` entry point):

```
Hard delivery rows: [{ "state": "injected", "attempt_count": 0, "last_error": null }]
Closure delivery rows: [{ "state": "injected" }]
All deliveries: injected
Events: [ "abort:ses_worker", "prompt:ses_worker", "prompt:ses_worker" ]
```

Unit test `closed room hard drain treats absent session status as eligible` also passes. All 11 hard-related tests pass with 0 failures.

**Status: RESOLVED**
