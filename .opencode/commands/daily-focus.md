---
description: Propose 1-3 tasks for today sized to Master's real time window; on pickup, block them on Google Calendar; on work reports, update the Todo Ledger.
agent: sebastian
---

Run the `prioritize-tasks` skill, then produce today's daily-focus proposal.

This session is the all-day todo-ledger loop: morning proposal -> Master picks -> calendar blocked -> Master works -> Master reports -> ledger updated, so the next day's proposal starts from the latest state.

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

## On Master's work report (after working a blocked task)

Master reports what was finished, partially finished, or not done, and why. Update `~/obsidian/Todo Ledger.md` accordingly — these status lines are what tomorrow morning's proposal reads:

- **Finished:** check the item off `[x]` with the done-date; for grouped items, mark the completed sub-items with dated status.
- **Partially finished:** keep the item open; annotate exactly what was done and what remains, dated (e.g., "markdown draft done 2026-08-17").
- **Not done:** record the reason or blocker on the item, dated, so the next proposal resizes it, re-proposes it, or waits on the blocker instead of re-suggesting blindly.
- If the report reveals a priority shift, update **Focus This Week** immediately (skill: Ledger hygiene).
- Commit and push the ledger after every report — never leave vault edits unpushed.

Keep it concise. One context line, the tasks, the reply prompt. No preamble.
