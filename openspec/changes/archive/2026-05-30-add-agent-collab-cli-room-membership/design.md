## Context

The PRD defines the CLI as a thin wrapper for agent use via bash, with mutating commands requiring explicit caller identity (`notes/agent-collaboration.md` lines 680-689). Room create output must prominently show the one-time planner password (lines 734-739).

## Goals / Non-Goals

**Goals:**
- Implement room, member, join, leave, and spawn CLI commands.
- Provide human-readable output by default and `--json` structured output.
- Resolve rooms by the server-supported room identifier/name without exposing password data except room creation response.

**Non-Goals:**
- No message send/ask/answer/messages CLI in this change.
- No direct database access from the CLI.

## Decisions

- Keep the CLI as an HTTP wrapper so behavior remains server-authoritative and testable with mocked HTTP responses.
- Require `--session` and `--from` for member-authored mutating commands except password self-join, matching the PRD command shape.
- Read `--password-stdin` without logging or echoing the secret.

## Risks / Trade-offs

- Human-readable output can hide machine errors -> Every command supports `--json` and tests cover both modes.
- Password handling is sensitive -> Tests assert password is only printed by `room create` and never by status/list.
