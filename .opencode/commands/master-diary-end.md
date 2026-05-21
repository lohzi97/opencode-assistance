---
description: Turn the day's diary conversation into a diary entry and commit it
agent: sebastian
---

The diary anchor session is ending. Turn everything discussed into a point-form diary entry and write it to the diary repository.

## Date

Run `date +%Y%m%d` to get today's date. This is the diary date.

If this session was opened on a different date (check the conversation context or the rollover summary), use the original date instead, not today's date.

## Instruction

1. Review the full conversation in this session, including any rollover summary that was carried over from a previous anchor session for this diary date.

2. Synthesize everything into a descriptive point-form diary entry.

3. Ensure the directory `~/diary/YYYY/MM/` exists (create it if needed).

4. Write the entry to `~/diary/YYYY/MM/DD.md` using the format below.

5. Stage and commit the file in the `~/diary/` repo with message "Add diary entry for YYYY-MM-DD".

6. Confirm to the Master that the diary entry has been written and committed.

## Output Format

```markdown
# {display date, e.g. 22 May 2026}

## Events & Activities

- Descriptive bullet of something the Master did.
- Descriptive bullet of another event or activity.
- Include specific details: people, places, times, outcomes.

## Thoughts & Feelings

- How the Master was feeling at some point in the day.
- Something the Master reflected on or had an opinion about.
- Energy level or mood observations.

## Notable Details

- Something interesting the Master encountered.
- A decision or plan the Master mentioned.
- Anything else worth preserving: health notes, habits, observations.

## Highlights

- One or two bullets capturing the most memorable or significant moments of the day, if any stood out.
```

## Writing Guidelines

- Write in the third person about the Master ("Master did X," "Master felt Y"), or in a neutral descriptive voice. Be consistent throughout.
- Be descriptive and specific. "Master had lunch with a former colleague at a Japanese restaurant in Bangsar" is far better than "Master had lunch."
- Preserve the Master's voice and intent. If the Master described something in a particular way, honor that.
- Keep it factual. Do not invent details that were not mentioned.
- If a section has nothing to report, omit that section entirely rather than writing "Nothing notable."
- The `Highlights` section is optional. Only include it if the day had clear standout moments.

## Constraints

- Do not ask the Master any further questions. Work with what you have.
- Do not include Sebastian's own thoughts, commentary, or meta-notes. This diary is purely about the Master.
- If `~/diary/` does not exist or is not a git repo, report the error and stop.
