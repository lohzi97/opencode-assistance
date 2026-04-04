---
description: Generate a daily journal diary from session conversation history
---

Create a daily journal diary for date $1 (format: YYYYMMDD). If no date provided, use today's date.

Instruction:

1. Locate session files
   - Find all files in `journals/session/` matching the date pattern `$1*`.

2. Read sessions
   - Read each session file in full, including frontmatter metadata (session-id, created, updated, exported) and the conversation body.

3. Critical verification (must do)
   - For the actual result that yield from the conversation session, perform a simple verification on it to ensure that the result is still valid.
     - Example:
       - Conversation mentioned that xxx file has been created > verify that the file exist
       - Conversation mentioned that it added a git commit > verify that the git commit exist
       - Conversation mentioned that it generated a git commit message but has not committed it > no verification need as it is a chat respond
       - Conversation mentioned that it created an backend app > verify that the created backend app exist and is runable.
       - Conversation mentioned that it did research on yyy topic > no verification needed as it is also chat respond without actual result
   - Record the verification result in the journal.

4. Write the journal
   - Use the 'write-journal' skill to write the journal to `journals/daily/$1.md`.
   - The skill will provide the formatting, style rules, and do's/don'ts for writing the journal.
   - If the file exists, overwrite it.

5. Journal-specific details
   - Journal type title: `Daily Journal`
   - Session subheadings should use times derived from session `created` and `updated` metadata
   - Ensure the `Generated:` line is included at the end of the journal

Example invocation: `/write-diary YYYYMMDD`
