---
description: Propose 1-3 tasks for today sized to Master's real time window; on pickup, block them on Google Calendar.
agent: sebastian
---

Run the `prioritize-tasks` skill, then produce today's daily-focus proposal.

## Steps

1. Determine today's date and day-of-week (`date`).
2. Compute gym-week parity and whether today is a gym day (skill formula).
3. Check whether today is a public holiday (query `en.malaysia#holiday@group.v.calendar.google.com` for today; apply the Selangor filter for state holidays).
4. Derive today's side-work window — work-day evening vs weekend/PH block (use the time-budget note).
5. Load `~/obsidian/Todo Ledger.md`. Read **Focus This Week** first, then the highest-priority open items.
6. Select **1-3 tasks** that FIT today's window and serve the #1 priority (trading edge) first, then the most urgent/time-bound items. Match task type to slot energy (hard deep-work only in prime slots; admin on gym days).
7. Post the proposal in the skill's daily output format (context line + tasks + reply prompt).
8. **STOP and wait** for Master's reply.

## On Master's reply

- **Master picks number(s):** create a Google Calendar event on `lohzi97@gmail.com` for each picked task (`manage_event`, action `create`; duration from the window; add a reminder). Confirm what was blocked.
- **Master says "tired" / low energy:** re-propose light/admin tasks only, or a rest block. Never push deep work.
- **Master steers differently:** re-propose per their direction.
- **Master reports a mid-day change:** recompute against the remaining window and re-propose.

Keep it concise. One context line, the tasks, the reply prompt. No preamble.
