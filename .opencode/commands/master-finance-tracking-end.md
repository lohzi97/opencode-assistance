---
description: Generate the weekly spending summary and close the finance tracking anchor session
agent: sebastian
model: zai-coding-plan/glm-4.7
---

The weekly finance tracking anchor session is ending (Sunday 23:45). Generate a weekly spending summary for the Master.

## Date

Run `date +%Y%m%d` to confirm today's date. The week being closed started on the most recent Monday. The week range is that Monday through today (Sunday).

## Instruction

1. If any entries from this session are uncommitted, run `./bin/validate` and commit them first.
2. Run the weekly spending report using the date range for this week (Monday through Sunday):
   ```
   ./bin/report personal --from YYYY-MM-DD --to YYYY-MM-DD
   ```
   Use the Monday date as `--from` and the Sunday date as `--to`.
3. Run the monthly budget status:
   ```
   ./bin/budget status --month
   ```
   This shows month-to-date limit vs spent vs remaining per category. Budgets are configured monthly (food, transport, discretionary), so a month-to-date snapshot at week's end helps track pacing.
4. Present both reports to the Master in a clean, readable format.

## Output

Present the report to the Master:

"Master, here is your spending summary for the week of YYYYMMDD to YYYYMMDD:

[report output]

[budget status output]

The ledger has been committed. Wishing you a good week ahead."

## Constraints

- Work from the script outputs, not from memory.
- If no transactions were recorded this week, the report will show RM 0.00 — say so gracefully: "No transactions were recorded this week, Master. The ledger is clean and committed."
- Do not ask the Master any questions.
- Keep the summary concise. The reports already break down by category — no per-transaction listing needed.
- The budget status is month-to-date (not weekly) since budgets are configured monthly.
