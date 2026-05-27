## Context

The PRD requires rooms to be global within the current OpenCode backend instance, with `project_dir` as routing metadata rather than isolation (`notes/agent-collaboration.md` lines 75-79). Room creation also establishes the first planner and returns the only plaintext planner password (lines 351-394).

## Goals / Non-Goals

**Goals:**
- Implement `POST /room`, `GET /room/:room_id/status`, `GET /room/list`, and `DELETE /room/:room_id`.
- Persist system room messages for founder join and room close.
- Keep all inspection responses free of password data.

**Non-Goals:**
- No non-founder member APIs, message sending, or delivery injection.

## Decisions

- Resolve room identifiers by persisted full name and internal id where practical so the CLI can use human-readable room names later.
- Treat close as a mutation that writes the final closure message before setting the room closed, matching PRD lines 852-856.
- Include only active members in status now; pending delivery and OpenCode state enrichment can be extended by later delivery changes.

## Risks / Trade-offs

- Status is intentionally partial until delivery and OpenCode state exist -> Tests should assert password secrecy and lifecycle state now, not future counters.
- Timestamped names can collide in fast tests -> Include an id-backed uniqueness fallback or retry path.
