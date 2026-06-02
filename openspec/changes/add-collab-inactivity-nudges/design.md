## Context

`agent-collab` rooms are coordinated through stored room messages and delivery records that are eventually injected into member sessions via OpenCode `prompt_async`. The existing delivery engine runs on a fallback tick and on backend events, but it only injects when there are pending deliveries. If a collaborator forgets to report progress, no new delivery is created, and planners receive no signal that the room may be stalled.

The current service already has the right integration points: collab configuration in `.opencode/server/config.ts`, room/message/delivery persistence in `.opencode/server/collab.ts`, status output through `roomStatus`, and a periodic `tickDelivery()` loop.

## Goals / Non-Goals

**Goals:**

- Detect open rooms whose meaningful activity has been silent for longer than a configurable threshold.
- Nudge active planners only, so the orchestrator can remind collaborators, ask for status, or close the room.
- Persist enough state to make nudges durable across worker restarts and visible in room status.
- Exclude inactivity notices from meaningful activity so the watchdog cannot satisfy itself.
- Keep the feature additive and disabled-safe.

**Non-Goals:**

- Do not introduce task status tracking, readiness tracking, or automatic room closure.
- Do not send default nudges to implementers, reviewers, or other non-planner members.
- Do not add new CLI commands; existing `room status` and `messages` are sufficient surfaces.
- Do not change normal send, ask, answer, hard interrupt, or closed-room drain semantics.

## Decisions

### Decision: Model inactivity nudges as system room messages with special kind

The service will create a system-authored message with kind `inactivity_notice` when a room qualifies. Deliveries for that message target active planner members with immediate soft mode.

Rationale: Persisted messages preserve an audit trail and reuse existing delivery rendering, ordering, failure handling, member agent/model routing, and transcript APIs.

Alternative considered: ephemeral prompt injection without a stored message. This would keep transcripts cleaner, but it would make watchdog behavior harder to inspect, test, and recover after restart.

### Decision: Track nudge cadence separately from meaningful activity

The room state will expose `last_meaningful_activity_at`, `last_inactivity_nudge_at`, `inactive_for_ms`, and `next_inactivity_nudge_at` in status. `last_meaningful_activity_at` is derived from non-`inactivity_notice` room messages, while `last_inactivity_nudge_at` is stored durably.

Rationale: Separating these clocks prevents notice messages from resetting inactivity while still allowing rate limiting.

Alternative considered: use the latest message timestamp for all activity. This is incorrect because every watchdog message would make the room look active.

### Decision: Default to planner-only immediate soft delivery

Inactivity notice deliveries target active members with role `planner`, using immediate soft delivery. They obey the existing immediate blockers: pending user question and `retry` block delivery; `busy` does not.

Rationale: The planner owns room orchestration. Interrupting implementers by default would create noise during legitimate long-running work.

Alternative considered: target `@everyone`. This maximizes visibility but undermines the purpose of keeping workers focused.

### Decision: Keep configuration small and nested under `collab.inactivity_nudge`

Configuration will be additive:

```jsonc
{
  "collab": {
    "inactivity_nudge": {
      "enabled": true,
      "threshold_ms": 900000,
      "repeat_ms": 900000,
      "message": {
        "text": "The room has been inactive for {duration}. Try sending a reminder if you are waiting for a reply. Close the room if it is no longer needed."
      }
    }
  }
}
```

`message` follows the existing instruction-source pattern and supports either text or file content. The template can use `{room}` and `{duration}`. If absent, the service uses a built-in fallback message.

Rationale: This keeps the feature configurable without creating a policy language.

Alternative considered: hard-code the message and threshold. This would be simpler, but the correct threshold differs between quick review rooms and long implementation rooms.

### Decision: Evaluate inactivity during the existing delivery tick

`tickDelivery()` will first create any due inactivity notices for open rooms, then flush pending deliveries. The service should avoid duplicate notice creation by performing the eligibility check and `last_inactivity_nudge_at` update in one storage operation or transaction.

Rationale: Reusing the existing delivery timer avoids another scheduler and ensures newly-created notice deliveries are flushed promptly.

Alternative considered: a separate interval. This would add lifecycle complexity without meaningful benefit.

## Risks / Trade-offs

- [Risk] Frequent nudges could annoy planners during legitimate long tasks. → Mitigation: configurable threshold/repeat interval, planner-only targeting, and no hard interrupts.
- [Risk] Persisted notice messages could add transcript noise. → Mitigation: use a distinct `inactivity_notice` kind so transcript consumers can filter or recognize them.
- [Risk] Race conditions could create duplicate notices on overlapping ticks/events. → Mitigation: serialize through the existing delivery flush lock and update `last_inactivity_nudge_at` transactionally when creating the notice.
- [Risk] Rooms with only non-planner active members should not be nudged. → Mitigation: open-room invariants require at least one planner; if data is inconsistent, skip notice creation when no active planner target exists.

## Migration Plan

- Add optional config parsing with defaults so existing `server.jsonc` remains valid.
- Add an additive migration for `rooms.last_inactivity_nudge_at` or equivalent durable state.
- Existing rooms start with `last_inactivity_nudge_at = NULL` and become eligible based on their existing meaningful message history.
- Rollback is safe: older code ignores any extra SQLite column if the migration has already run.

## Open Questions

None.
