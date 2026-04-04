---
description: Generate a daily journal diary from session conversation history
---

Create a daily journal diary for date $1 (format: YYYYMMDD). If no date provided, use today's date.

Follow this workflow:

1. Find all session files in `journals/session/` that match the date pattern $1* (e.g., 20260329*)
2. Read through ALL session files completely to understand the full conversation history
3. Analyze and summarize the conversations into a structured daily diary with these sections:
   - Session Overview
   - Key Activities
   - Technical Accomplishments
   - Notes
4. **CRITICAL**: Fact-check all files, directories, and paths mentioned in the conversation history against the actual filesystem before writing. Verify what actually exists vs. what was discussed.
5. Write the daily journal to `journals/daily/$1.md`
6. If the file already exists, overwrite it with the corrected version

Keep the diary:
- Concise but comprehensive
- Focused on actual accomplishments and outcomes
- Factually accurate based on filesystem verification
- Free of "Next Steps" section
- Using markdown formatting with proper headers

Example: /write-diary 20260329
