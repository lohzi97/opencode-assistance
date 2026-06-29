---
name: manage-reminders
description: Create, update, cancel, and list one-off scheduled reminders using the proactive task queue. Use when the Master says "remind me", "add a reminder", "set a reminder", "update/reschedule the reminder", "cancel/drop the reminder", "I no longer need to be reminded", or any request involving scheduling a future notification, nudge, or alert.
---

# Manage Reminders

Translate natural-language reminder requests into proactive queue operations.
This skill is the user-friendly layer; it loads `manage-proactive-tasks` for the
CLI command mechanics and field semantics.

## Scope

This skill handles **one-off** reminders only — fire once, self-clean. Recurring
reminders (e.g. "every Monday at 9am") are configured tasks in `server.jsonc`
and belong to `configure-proactive-task`, not here.

## Operation Types

- **Create**: "remind me on Monday to...", "add a reminder for..."
- **Update**: "move the reminder to...", "reschedule the X reminder..."
- **Cancel**: "cancel the reminder", "drop the reminder", "I no longer need..."
- **List**: "what reminders do I have?", "show me my reminders"

## Rules

1. Load the `manage-proactive-tasks` skill before any CLI operation.
2. Collect ALL required parameters before acting. Never assume missing values.
3. Always display the full parameter set and wait for explicit approval before
   executing any CLI command. Never act without the Master confirming.
4. Default `agent` to `sebastian` for all reminders.
5. Always compute `ttl_ms` to cover the gap between now and `not_before` plus a
   1-hour grace window. Never use default TTL for future-scheduled items.
6. Phrase `instructions` as a complete directive to the agent at fire time. The
   agent session has zero context about why the reminder was created — it only
   sees the `instructions` text.
7. Use `Asia/Kuala_Lumpur` (UTC+8) for all date/time interpretation unless the
   Master specifies otherwise.

## Workflow: Create

1. Collect from the Master:
   - **What**: the reminder content (what to be reminded about)
   - **When**: date AND time. If time is missing, ask: "What time on [date]?"
     Offer sensible defaults (08:00, 09:00) as suggestions. If date is relative
     ("tomorrow", "next Monday", "in 3 hours"), resolve it.

2. Compute `not_before` epoch ms:
   ```sh
   date -d "YYYY-MM-DD HH:MM:00 +0800" +%s%3N
   ```

3. Compute `ttl_ms`:
   ```
   ttl_ms = (not_before - now_ms) + 3600000
   ```

4. Build `instructions` as a self-contained directive:
   ```
   "Remind the Master that [content]. Deliver this as a concise personal
   reminder in your butler voice."
   ```

5. Check quiet hours (23:00-08:00 MYT). If the reminder fires during quiet
   hours, warn the Master that telegram delivery may be suppressed.

6. Display parameters for approval:
   ```
   What:   [instruction text]
   When:   [human-readable date/time MYT]
   TTL:    [human-readable duration]
   Agent:  sebastian
   ```

7. On approval, execute:
   ```sh
   printf '%s' '{...json...}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
   ```

8. Report the returned `queue_id` so the Master can reference it later.

## Workflow: Update

1. Run `get-all-tasks` to list queued items.
2. Identify the target. Match by instruction content, or list candidates and
   ask the Master to confirm which `queue_id`.
3. Collect new values (new date/time, new content, new priority).
4. Recompute `not_before` and `ttl_ms` if the date/time changed.
5. Display current values and proposed new values side by side.
6. On approval, execute:
   ```sh
   printf '%s' '{...json...}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task <queue-id> --stdin
   ```

## Workflow: Cancel

1. Run `get-all-tasks` to list queued items.
2. Identify the target (same as Update step 2).
3. Display what will be removed: instruction text and scheduled time.
4. On approval, execute:
   ```sh
   bun .opencode/scripts/proactive-cli.ts remove-queued-task <queue-id>
   ```

## Workflow: List

1. Run `get-all-tasks`.
2. From the `queue` array, present each item in human-readable format:
   - Scheduled: [date/time from not_before, converted to MYT]
   - Content: [instructions text]
   - ID: [queue_id]
3. Skip items that are clearly non-reminder ad-hoc tasks (use judgment based on
   instruction content). When uncertain, show everything.

## Relative Time Reference

Common patterns the Master may use and how to resolve them:

```sh
date -d "tomorrow 08:00:00 +0800" +%s%3N        # tomorrow morning
date -d "next monday 09:00:00 +0800" +%s%3N      # next Monday
date -d "in 3 hours" +%s%3N                      # relative
date -d "2026-07-06 08:00:00 +0800" +%s%3N       # explicit
```

To convert a `not_before` epoch ms back to readable MYT for display:

```sh
date -d @<epoch_seconds> "+%Y-%m-%d %H:%M %Z"
```
