---
description: Write a personal diary entry for the Master into ~/diary/
agent: sebastian
model: zaicodingplan/glm4.7
---

Write a personal diary entry for the Master into the ~/diary/ repository.

## Input

Date argument: $ARGUMENTS

The argument is an optional date in YYYYMMDD format. If the argument is empty or whitespace, use today's date (local timezone) by running `date +%Y%m%d`.

## Workflow

1. Determine the target date. Use the date argument if valid YYYYMMDD, otherwise run `date +%Y%m%d`. Derive the display date (e.g. "16 June 2025") and the folder path (`~/diary/YYYY/MM/`).

2. Ask the Master: "How was your day on {display date}, Master? Share whatever you'd like to record."

3. Wait for the Master's reply. The reply will typically be rough point-form notes about the day's events.

4. Tidy the grammar and sentences. Keep the tone casual and natural, as if the Master is writing it themselves. Preserve the Master's voice and intent. Keep it as point-form bullets.

5. Ensure the directory `~/diary/YYYY/MM/` exists (create it if needed).

6. Write the entry to `~/diary/YYYY/MM/DD.md` using this format:

```
# {display date}

- Point one.
- Point two.
- ...
```

7. Stage and commit the file in the ~/diary/ repo with message "Add diary entry for YYYY-MM-DD".

8. Confirm to the Master that the entry has been written and committed.
