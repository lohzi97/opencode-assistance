---
name: session-archive
description: Archive, unarchive, list, and check the archive status of OpenCode sessions via direct database operations. Use when the Master says "archive this session", "unarchive this", "I accidentally archived", "restore a session", "show archived sessions", or any request involving session archive state that the OpenCode UI cannot handle (the UI has archive but no unarchive).
---

# Session Archive

Manage OpenCode session archive state. The OpenCode UI can archive sessions
but provides **no unarchive** action. This skill covers both directions.

## When to use me

- Master asks to unarchive / restore a session.
- Master asks to archive a session by ID (programmatic, not via UI).
- Master asks to list or find archived sessions.
- Master asks to check whether a session is archived.

## How it works

Archiving sets the `time_archived` column (epoch ms, integer) on the `session`
row in `opencode.db`. The session list filters out rows where
`time_archived IS NOT NULL`. Unarchiving sets the column back to `NULL`.

Key technical detail: `opencode db "<query>"` opens the database **read-only**
(safe for SELECTs). Writes must go through raw `sqlite3` on the path returned
by `opencode db path`.

## Script

All operations are wrapped in `.opencode/scripts/session-archive.sh`:

```sh
# List all archived sessions (id, title, archived-time)
bash .opencode/scripts/session-archive.sh list

# List ALL sessions with archive status
bash .opencode/scripts/session-archive.sh list-all

# Check a specific session's archive status
bash .opencode/scripts/session-archive.sh status <session-id>

# Archive a session
bash .opencode/scripts/session-archive.sh archive <session-id>

# Unarchive a session
bash .opencode/scripts/session-archive.sh unarchive <session-id>
```

The script verifies the session exists before writing and prints the resulting
status after any mutation.

## Rules

1. If the Master gives a session ID, operate directly. If not, run `list` to
   show archived sessions and ask which to restore.
2. After unarchiving, advise the Master to restart the TUI/app if the session
   does not reappear immediately.
3. Avoid writing while the opencode server is under heavy load; if a write
   fails with a lock error, retry once after a brief pause.
