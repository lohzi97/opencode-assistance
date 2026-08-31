---
description: Turn the day's diary conversation into a diary entry, commit it, and push it
agent: sebastian
model: zai-coding-plan/glm-5.3-flash
---

The diary anchor session is ending. Turn everything discussed into a point-form diary entry and write it to the diary repository.

## Date

First determine the diary date covered by this anchor session. The diary date is the date when the anchor session was originally opened, not the current wall-clock date.

Find the diary date in this priority order:

1. The original anchor-session opening context or opening assistant message.
2. The rollover summary's `Diary Date` section, if this session rolled over.
3. The first explicit diary-date statement already established earlier in this session.
4. Only if none of the above exist, run `date +%Y%m%d` as a last-resort fallback.

Once found, treat that `YYYYMMDD` value as immutable for the rest of this session.

- Do not recompute the diary date later.
- Do not change it based on words like "today", "yesterday", or the time when the Master replies.
- Do not derive the path from the display title text.
- Do not let the current date override the original anchor date.

Convert the final diary date into:

- `YYYY`
- `MM`
- `DD`
- path: `~/diary/YYYY/MM/DD.md`

## Instruction

1. Review the full conversation in this session, including any rollover summary that was carried over from a previous anchor session for this diary date.

2. Separate actual diary material from Sebastian-originated check-in prompts. Only the Master's own recounts, answers, and facts count as diary content.

3. If the Master has not shared any diary material yet for this diary date:
   - Do not write any diary file.
   - Do not create directories.
   - Do not stage, commit, or push anything.
   - Send one concise message telling the Master the diary for `YYYY-MM-DD` is still pending and that whenever they share what happened that day, you will record it under that same date.
   - Then stop and wait. If the Master later replies in this same session with the day's recount, continue from these instructions using the same immutable diary date.

4. If the Master shares the day's recount after the end trigger fired, still write it to the original anchor date for this session, not the date of the later reply.

5. Synthesize all diary material into a descriptive point-form diary entry.

6. Ensure the directory `~/diary/YYYY/MM/` exists (create it if needed).

7. Write the entry to `~/diary/YYYY/MM/DD.md` using the format below.

8. Stage the file in `~/diary/`, commit it with message `Add diary entry for YYYY-MM-DD`, and push it to the current remote branch immediately.

9. Confirm to the Master that the diary entry has been written, committed, and pushed, and explicitly state which diary date was recorded.

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
- If the Master shared details after midnight while recounting the previous day, preserve them under the original diary date when they describe that day.

## Constraints

- Never write to the wrong year, month, or day because of current time drift.
- Never create a second file for the same day under a different date path.
- Never use "yesterday" arithmetic if the anchor date is already known.
- Never create or update any diary file when there is still no Master-provided diary content.
- Do not include Sebastian's own thoughts, commentary, or meta-notes. This diary is purely about the Master.
- If `~/diary/` does not exist or is not a git repo, report the error and stop.
