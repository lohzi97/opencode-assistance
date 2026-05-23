---
name: create-custom-skill
description: Create an OpenCode skill from completed work by summarizing the work, consulting the skills docs, and writing the SKILL.md file with proper structure, optional bundled resources, and a trigger-rich description. Use when the user asks to create, write, or build a new skill based on completed work.
---

# Create Custom Skill

Use this skill when the user says something like "Based on what you have done, create a xxx skill for it" or asks to create a new skill.

## Process

1. Summarize what you have done into concise but detailed steps.
2. Read the OpenCode skills documentation before writing anything.
   - Use the official skills guide: `https://opencode.ai/docs/skills/`
   - Inspect existing skill files in the project for conventions.
3. Decide the skill structure based on the guidelines below.
4. Create the skill with proper frontmatter, description, and content.
5. Verify against the review checklist.

## OpenCode Frontmatter Requirements

Every `SKILL.md` must start with YAML frontmatter:

- `name` (required): 1-64 chars, lowercase alphanumeric with single hyphen separators, must match the directory name. Regex: `^[a-z0-9]+(-[a-z0-9]+)*$`
- `description` (required): 1-1024 chars. Must be specific enough for the agent to choose correctly.
- `license` (optional)
- `compatibility` (optional)
- `metadata` (optional, string-to-string map)

Place project skills in `.opencode/skills/<name>/SKILL.md`. The directory name must match the `name` field exactly.

## Writing a Good Description

The description is the **only thing** an agent sees when deciding which skill to load. It is surfaced in the system prompt alongside all other installed skills.

**Goal**: Give the agent enough info to know what capability the skill provides and when to trigger it.

**Format**:
- Max 1024 chars.
- First sentence: what it does.
- Second sentence: "Use when [specific triggers]."

**Good example**: `Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when user mentions PDFs, forms, or document extraction.`

**Bad example**: `Helps with documents.`

## Skill Structure

Use the minimal structure needed. Only add files when the skill genuinely benefits from them.

```
skill-name/
├── SKILL.md           # Main instructions (required)
├── REFERENCE.md       # Detailed docs (if needed)
├── EXAMPLES.md        # Usage examples (if needed)
└── scripts/           # Utility scripts (if needed)
    └── helper.sh
```

### When to add scripts

Bundle utility scripts when:
- The operation is deterministic (validation, formatting, data extraction).
- The same code would be generated repeatedly without the script.
- Errors need explicit, reproducible handling.

Scripts save tokens and improve reliability versus generated code.

### When to split files

Extract content to separate files when:
- `SKILL.md` exceeds 200 lines.
- Content has distinct domains (e.g. different schemas or operating modes).
- Advanced features are rarely needed and would bloat the main file.

Link to split files from `SKILL.md` using relative paths. Keep references one level deep -- do not nest further.

## SKILL.md Content Template

```markdown
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
---

# Skill Name

## When to use me
[Clear description of when this skill should be loaded and used.]

## Rules
[Concise behavioral constraints and conventions the agent must follow.]

## Workflows
[Step-by-step processes with commands or checklists for complex tasks.
Include concrete code examples inline when they are short.]

## Advanced features
[Link to separate files if split: See [REFERENCE.md](REFERENCE.md)]
```

Not every section is required. Use only the sections the skill needs. Keep it focused on the actual workflow.

## Review Checklist

After drafting, verify:

- [ ] Description includes triggers ("Use when...")
- [ ] Description is under 1024 chars
- [ ] `name` matches the directory name exactly
- [ ] `name` is lowercase alphanumeric with single hyphens, no leading/trailing hyphens, no consecutive `--`
- [ ] `SKILL.md` is under 200 lines (split if needed)
- [ ] No time-sensitive info (dates, versions) unless inherently part of the skill
- [ ] Consistent terminology throughout
- [ ] Concrete examples included for non-trivial workflows
- [ ] File references are one level deep at most
- [ ] Scripts are executable and handle errors explicitly
- [ ] The skill is focused on the user's requested intent

## Output Expectations

- Be concise.
- Preserve the user's requested intent.
- Prefer a reusable skill that can be loaded directly by name.
