## 1. Configuration And Storage

- [x] 1.1 Add `collab.inactivity_nudge` config types, defaults, and validation for `enabled`, `threshold_ms`, `repeat_ms`, and optional message source.
- [x] 1.2 Resolve the inactivity nudge message template from configured text/file or built-in fallback, supporting `{room}` and `{duration}` variables.
- [x] 1.3 Add an additive SQLite migration for durable `last_inactivity_nudge_at` state on rooms or an equivalent durable room-level table.
- [x] 1.4 Add storage helpers to compute `last_meaningful_activity_at` while excluding `inactivity_notice` messages.

## 2. Status And Transcript Semantics

- [x] 2.1 Extend room status responses with `last_meaningful_activity_at`, `last_inactivity_nudge_at`, `inactive_for_ms`, and `next_inactivity_nudge_at`.
- [x] 2.2 Ensure `inactivity_notice` messages are persisted as system-authored transcript entries and remain visible through existing message APIs.
- [x] 2.3 Ensure `inactivity_notice` messages do not update or reset meaningful-activity calculations.

## 3. Watchdog And Delivery Behavior

- [x] 3.1 Add delivery-tick evaluation for open rooms that qualify for inactivity nudges.
- [x] 3.2 Create one `inactivity_notice` message and immediate soft delivery records for active planner members only when a room qualifies.
- [x] 3.3 Rate-limit repeat notices using the later of the last meaningful activity and `last_inactivity_nudge_at`.
- [x] 3.4 Skip closed rooms and rooms with no active planner delivery targets.
- [x] 3.5 Ensure newly-created inactivity notices flush through the normal delivery path and preserve target planner agent/model/variant routing.
- [x] 3.6 Ensure inactivity notice deliveries obey existing immediate soft blockers: allowed during `busy`, blocked during pending user question and `retry`.
- [x] 3.7 Render inactivity notice prompts with room identity, current public message when present, notice body, and one resolved reply instruction.

## 4. Tests And Verification

- [x] 4.1 Add unit tests for inactivity config defaults, validation, and message template resolution.
- [x] 4.2 Add storage/status tests for meaningful-activity calculation, notice persistence, and status metadata fields.
- [x] 4.3 Add delivery-engine tests for inactive open room notice creation, recent activity suppression, repeat rate limiting, and closed-room exclusion.
- [x] 4.4 Add delivery tests proving planner-only targeting, removed planner exclusion, and implementer non-targeting.
- [x] 4.5 Add delivery tests for immediate soft blocker behavior and prompt rendering with public-message context.
- [x] 4.6 Run the relevant repository test command and `openspec status --change add-collab-inactivity-nudges` to verify the change is apply-ready.
