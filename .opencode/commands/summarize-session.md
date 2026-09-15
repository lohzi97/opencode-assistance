---
description: Summarize a single session markdown file into a session-summary
agent: sebastian
model: deepseek/deepseek-v4-flash
---

You are given a session file path as input. Summarize it into a structured summary file.

## Input

The argument to this command is the path to a session markdown file, e.g.:
`/summarize-session journals/session/20260315215648266-ses_23b145357fdezFzghRD1OdWRoy.md`

## Instruction

1. Parse the input path to extract:
   - **Date prefix**: the first 8 characters of the filename (YYYYMMDD). e.g. `20260425`
   - **Session ID**: the part with `ses_` and `.md`. e.g. `ses_23b145357fdezFzghRD1OdWRoy`

2. Read the session file at the given path.

3. Analyze the session content and produce a summary following the **Output Format** below.

4. Construct the output path: `journals/session-summary/YYYYMMDD_sessionId.md`
   e.g. `journals/session-summary/20260425_ses_23b145357fdezFzghRD1OdWRoy.md`

5. Ensure the `journals/session-summary/` directory exists (create it if needed).

6. Write the summary to the output path. Overwrite the output file if it already exists.

## Output Format

The output file must contain exactly these three sections:

### 1. What we have done
- Bulleted summary of actual actions taken, files created/modified, and final outcomes or deliverables.

### 2. Why we do it
- The context, underlying problem, or motivation behind the session. What was the core goal or bug being addressed?

### 3. How we do it
- Technical execution details.
- Specific tools utilized (e.g. `chain-of-verification` skill, `todowrite` for planning, `bash` for testing).
- Strategies, terminal commands, or architectural approaches used.

## Constraints
- Do not hallucinate or infer actions not explicitly present in the log.
- Maintain clean, readable Markdown format.
- Focus on technical substance over conversational filler.
