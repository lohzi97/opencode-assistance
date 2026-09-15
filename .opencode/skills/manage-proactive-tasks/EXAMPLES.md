# Examples: Proactive Task CLI Operations

These examples are intended to be copied with minimal adjustment.

### Example 1: List everything first

Use this when the Master asks what tasks exist or when IDs are unknown.

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
```

Use this before running a task, editing a queued item, or removing a queued item.

### Example 2: Run a configured task immediately

If the configured task ID is `daily-review`:

```sh
bun .opencode/scripts/proactive-cli.ts run-task-now daily-review
```

Use this only for configured task IDs. If the Master says "run that queued item now," first inspect whether they actually mean a configured task or whether a queue edit is needed instead.

### Example 3: Remove a queued ad-hoc item

If the queue item ID is `pq_abc123`:

```sh
bun .opencode/scripts/proactive-cli.ts remove-queued-task pq_abc123
```

Use this only for queued item IDs.

### Example 4: Add a simple ad-hoc queued item via stdin

```sh
printf '%s' '{
  "instructions": "Review current repository maintenance state and report only actionable issues.",
  "priority": 2,
  "ttl_ms": 1800000,
  "agent": "sebastian"
}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

This is the simplest useful pattern for new ad-hoc work.

### Example 5: Add an ad-hoc item with model and context via stdin

```sh
printf '%s' '{
  "instructions": "Research the failing proactive precheck and summarize the root cause.",
  "priority": 3,
  "agent": "sebastian",
  "model": {
    "providerID": "deepseek",
    "modelID": "deepseek-v4-flash"
  },
  "context": {
    "task": "hello-testing",
    "requested_by": "master"
  },
  "dedupe_key": "research-hello-testing",
  "source": {
    "type": "manual"
  }
}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

### Example 6: Add an ad-hoc item from a file

Create a JSON payload file first, then run:

```sh
bun .opencode/scripts/proactive-cli.ts add-task-to-queue --file /absolute/path/to/payload.json
```

You may also pass a path positionally because the CLI accepts it:

```sh
bun .opencode/scripts/proactive-cli.ts add-task-to-queue /absolute/path/to/payload.json
```

Use `--file` when clarity matters.

### Example 7: Edit a queued item via stdin

If the queue ID is `pq_abc123`, and the Master wants to delay it and raise priority:

```sh
printf '%s' '{
  "priority": 5,
  "not_before": 1760000000000,
  "context": {
    "reason": "deferred until after current work"
  }
}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task pq_abc123 --stdin
```

### Example 8: Edit only the instructions of a queued item

```sh
printf '%s' '{
  "instructions": "Re-check the last proactive failure artifact and summarize only the concrete fix."
}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task pq_abc123 --stdin
```

### Example 9: Edit a queued item from a file

```sh
bun .opencode/scripts/proactive-cli.ts edit-queued-task pq_abc123 --file /absolute/path/to/edit-payload.json
```

### Example 10: Inspect before deciding whether to run, edit, or remove

Good operator pattern:

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
```

Then decide:

- if the target is a configured task ID, use `run-task-now`
- if the target is a queued item ID and needs changes, use `edit-queued-task`
- if the target is a queued item ID and should be deleted, use `remove-queued-task`

### Example 11: Schedule a future reminder with `not_before`

To queue a reminder for a specific future date/time, compute the epoch-ms
timestamp and pass it as `not_before`. Always set `ttl_ms` to cover the full
wait period (default 30 min is too short for distant reminders):

```sh
# Compute epoch ms for 2026-07-06 08:00 MYT (UTC+8)
NOT_BEFORE=$(date -d "2026-07-06 08:00:00 +0800" +%s%3N)

printf '%s' "{
  \"instructions\": \"Remind the Master to update the Versa app auto-debit plan for the monthly RM 1630 transfer. Deliver as a concise personal reminder.\",
  \"not_before\": ${NOT_BEFORE},
  \"ttl_ms\": 691200000,
  \"priority\": 3,
  \"agent\": \"sebastian\"
}" | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

The item persists across restarts and self-cleans after dispatch. No manual
cleanup is needed.

### Example 12: Add a dedup-protected task

Use `dedupe_key` when a script might enqueue the same task repeatedly and only
one copy should survive:

```sh
printf '%s' '{
  "instructions": "Check the deployment status and report any issues.",
  "dedupe_key": "deploy-check-20260706",
  "agent": "sebastian"
}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

If this is called again before the first item dispatches, the duplicate is
rejected with "dedupe key already queued or active".
