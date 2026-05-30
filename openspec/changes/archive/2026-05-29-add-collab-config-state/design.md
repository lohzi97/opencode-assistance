## Context

The PRD places `CollabService` inside the existing project worker beside compaction and proactive services, using shared OpenCode integration later (`notes/agent-collaboration.md` lines 49-62). This change stops before room behavior and focuses on stable startup, configuration, and durable schema.

## Goals / Non-Goals

**Goals:**
- Load and validate `collab` config from `.opencode/server.jsonc` and supported environment overrides.
- Initialize the SQLite schema from PRD lines 258-331.
- Provide template resolution for `spawn_instruction` and `reply_instruction` from PRD lines 894-910.
- Keep the service inert when disabled.

**Non-Goals:**
- No room API routes, delivery loop, CLI, or OpenCode session mutation.

## Decisions

- Use a single `CollabService` root module with internal storage/config helpers so later changes can extend one boundary rather than scatter worker logic.
- Store only planner password hashes; the one-time plaintext return is implemented later by room creation.
- Validate `hard_abort_wait_max_ms >= hard_abort_wait_ms` at config load time as required by PRD line 911.

## Risks / Trade-offs

- Schema drift from the PRD could break later proposals -> Add schema-level tests that assert table and column names.
- Misconfigured paths could write state outside the workspace -> Resolve relative paths from the project root and test overrides.
