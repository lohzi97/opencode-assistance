## Context

The collaboration service already has the core server-side room close API: `DELETE /room/:room_id` validates planner identity, records a terminal `room_closed` message, rejects later mutations, and allows existing backlog to drain. The CLI currently wraps most collaboration APIs through `.opencode/scripts/agent-collab.ts`, but it cannot close rooms through that script.

The existing project convention is to invoke local CLI scripts through Bun, as with `.opencode/scripts/proactive-cli.ts`. This change keeps that convention and only completes the missing room lifecycle command.

## Goals / Non-Goals

**Goals:**

- Add `room close` to the CLI as a thin wrapper over the existing `DELETE /room/:room_id` API.
- Preserve current command parsing style, error behavior, JSON mode, and `AGENT_COLLAB_URL` override.
- Cover the new command behavior with focused tests.

**Non-Goals:**

- No server API changes.
- No database schema changes.
- No room reopen, purge, or retention changes.
- No repository-local or global `agent-collab` wrapper.

## Decisions

- Keep `.opencode/scripts/agent-collab.ts` as the sole CLI implementation for this change. This matches the current script-based pattern and avoids adding an unnecessary invocation alias.
- Implement `room close` in the same dispatch group as `room create`, `room status`, and `room list`. Closing is part of room lifecycle and should use the same identity flags as the server API: `--room`, `--session`, and `--from`.
- Format successful human-readable close output using the returned room status. JSON mode should print the raw server response, matching existing thin-wrapper behavior.

## Risks / Trade-offs

- `room close` is terminal. Mitigation: require explicit planner identity flags and rely on server-side planner authorization; do not add local shortcuts that could bypass existing safety semantics.
