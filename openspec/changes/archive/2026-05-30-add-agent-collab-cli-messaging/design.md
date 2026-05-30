## Context

The PRD requires the CLI to be thin and bash-tool friendly, with message body input from direct text, files, or stdin (`notes/agent-collaboration.md` lines 682-725). This change deliberately avoids adding local workflow intelligence to the CLI.

## Goals / Non-Goals

**Goals:**
- Implement public-message, send, ask, answer, and messages commands.
- Support text/file/stdin body input where specified.
- Keep output predictable for both human operators and agents using `--json`.

**Non-Goals:**
- No polling UI, TUI, direct database reads, or local delivery simulation.

## Decisions

- Share body-reading helpers across public-message and send commands to keep stdin/file behavior consistent.
- Pass `--hard` only through `send`; hard validation remains server-side.
- Keep `messages` filtering flags as query parameters so server remains authoritative for transcript visibility.

## Risks / Trade-offs

- Stdin body handling can block accidentally -> Require explicit `--stdin` or `--body -` forms and cover them with tests.
- Hard sends through CLI are dangerous if misused -> CLI passes the flag transparently but does not bypass server planner checks.
