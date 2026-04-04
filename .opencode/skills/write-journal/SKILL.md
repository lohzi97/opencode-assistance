---
name: write-journal
description: Write consistent journal entries with proper formatting, style rules, and verification requirements
---

# Journal Writing Guidelines

Use this skill to write journal entries in a consistent, professional format.

## Required Journal Structure

Title: `# <Journal Type> - <Month> <DD>, <YYYY>` (full month name)

Sections:
- `## Session Overview`: 1-2 sentence summary of main themes and scope
- `## Key Activities`: chronological list with subheadings for each session/activity
- `## Technical Accomplishments`: numbered list grouped by category
- `## Notes`: bullet list for verification results, discrepancies, and important context

## Section Details

### Session Overview
- Concise summary (1-2 sentences)
- Mention number of sessions/activities and main themes
- Set context for the rest of the journal

### Key Activities
- Use subheading format: `### Session N (HH:MM - HH:MM TZ)` or `### Session N (HH:MM TZ)` or just `### Session N`
- Derive times from metadata if available; omit parentheses if no timestamps
- Under each session, use concise bullet points covering:
  - Original requests
  - Taken actions
  - Tools used
  - Outcomes

### Technical Accomplishments
- Numbered list grouped by category (Infrastructure, Workflow, Tools, Git Workflow, etc.)
- For each item, note verification status:
  - "verified" if created/executed on filesystem
  - "suggestion only" if only proposed

### Notes
- Bullet list including:
  - Files/paths checked with verification results (path: exists/missing)
  - Discrepancies between claims and filesystem state (explicitly name the file/path)
  - Persona or preference details affecting future interactions
  - Conservative actions taken (e.g., no terminals closed)
  - Required: `Generated: <datetime>` line at the end

## Formatting and Style Rules

### Tone
- Direct, factual, and concise
- Maintain consistency with existing journals
- Avoid editorializing or excessive commentary

### Code Content
- Use fenced code blocks ONLY for verbatim content
- Label each code block (e.g., "Suggested commit message", "Command executed")
- Do not put summaries or paraphrased content in code blocks

### What to Include
- Actual accomplishments and outcomes
- Verification results for all filesystem references
- Specific commands, commit messages, and technical details
- Time ranges and metadata when available

### What to Exclude
- "Next Steps" section (never include this)
- Speculative content or plans
- Fluff or filler content
- Repetitive information

## Common Patterns

### Filesystem Checks
When reporting verification:
- Include both path and result
- Format: `/path/to/file: exists` or `/path/to/file: missing`
- Surface any mismatches explicitly in Notes section

### Timestamp Handling
- Convert to local timezone when possible
- If conversion fails, display ISO timestamp from metadata
- Format: `HH:MM - HH:MM TZ` for ranges, or single time in parentheses
