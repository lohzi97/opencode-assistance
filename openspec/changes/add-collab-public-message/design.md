## Context

The public message is full-replace only, optional, and planner-controlled (`notes/agent-collaboration.md` lines 118-128). It is not a hidden state channel: changes emit normal room messages and notifications to other members.

## Goals / Non-Goals

**Goals:**
- Implement `POST /room/:room_id/public-message` and `DELETE /room/:room_id/public-message`.
- Update status fields `public_message_updated_by` and `public_message_updated_at`.
- Include current public message in all future collaboration prompt injections.

**Non-Goals:**
- No diffing, history compaction, summary, or oversized-context optimization.

## Decisions

- Use full replacement only and store only the latest public message on `rooms`, while transcript messages record update/clear events.
- Route update notifications as ordinary immediate deliveries so chronological batching rules remain consistent.
- Redact or reject planner password text if detected by exact current plaintext is impossible after creation; rely on not storing plaintext and document that API never returns it.

## Risks / Trade-offs

- Large public messages can inflate every prompt -> v1 accepts this per PRD line 142 and excludes summary optimization at lines 946-954.
- Clear notification has no public message body -> Prompt formatter must omit the public-message section or mark it empty consistently.
