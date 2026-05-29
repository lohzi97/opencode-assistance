# E2E Test Findings

## No Implementation Issues Found in Available Partial E2E Testing

- **Severity:** None
- **Date:** 20260529
- **What happened:** Available real-flow E2E tests passed for mention-triggered immediate delivery through an isolated collab HTTP service backed by the real OpenCode backend.
- **Expected:** Mentioned messages are immediate, busy targets can receive immediate delivery, older buffered context is injected before the newer immediate message, message `kind` does not alter urgency, and unknown mentions reject without delivery.
- **Evidence:** `bun ./server/collab-immediate-e2e.tmp.ts` created disposable sessions and room `e2e-collab-immediate-20260529203655`; worker status was `{ "type": "busy" }` during immediate send; worker transcript contained join bootstrap, `E2E older buffered context before immediate mention`, and `@worker E2E immediate decision point while worker is busy` in that order; worker-scoped deliveries were `bootstrap/injected`, `buffered/injected`, and `immediate/injected`; unmentioned `task_assignment` deliveries remained `buffered/pending`; mentioned `note` delivery was `immediate/pending`; unknown `@ghost` returned `400` with `unknown mention: @ghost`.
- **Affected requirement:** `collab-immediate-delivery` requirements for busy immediate delivery, older buffered context preservation, and kind-independent urgency.
- **Recommended follow-up:** No `/opsx-fix` required for these tested paths.

## Blocker: Retry and Pending User-Question States Not Fully E2E-Reproducible

- **Severity:** Medium
- **Date:** 20260529
- **What happened:** Full E2E coverage for immediate blocking during `retry` and pending user-question states could not be completed because this environment exposes observation APIs (`/session/status`, `/question`) but no safe deterministic public operation was identified to force a disposable session into `retry` or create a pending user question.
- **Expected:** E2E testing should validate that immediate deliveries remain pending when the target session is in `retry` or has a pending user question.
- **Reproduction steps:** Run capability checks against `http://127.0.0.1:4096/session/status` and `http://127.0.0.1:4096/question` with configured OpenCode credentials; observe that state can be read, but no safe state-induction endpoint/tooling is available in the current test environment.
- **Evidence:** Authenticated `/session/status` succeeded and showed only current session busy state during capability check; authenticated `/question` returned `[]`; no public API or fixture was available to set a disposable session to `retry` or pending user question without relying on destructive or nondeterministic provider/tool failures.
- **Affected requirement:** `Immediate soft delivery respects soft blockers`, scenarios `Retry target blocks immediate message` and pending user-question blocker from requirement text.
- **Recommended follow-up:** Provide or approve a safe fixture/mocking harness at the OpenCode boundary for E2E state induction, or accept automated integration coverage for these two blocker paths and run `/opsx-align add-collab-immediate-delivery` only if the intended manual-testing bar is partial rather than full external E2E.
