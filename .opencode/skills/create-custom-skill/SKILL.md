---
name: create-custom-skill
description: Create an OpenCode skill from completed work by summarizing the work, consulting the skills docs, and writing the SKILL.md file.
---

# Create Custom Skill

## When to Use

Use this skill when the user says something like: "Based on what you have done, create a xxx skill for it."

## Workflow

1. Summarize what you have done into concise but detailed steps.
2. Read the OpenCode skills documentation before writing anything.
   - Use the official skills guide: `https://opencode.ai/docs/skills/`
   - Inspect an existing skill file in the project if one is available.
3. Create the skill based on the documentation.
   - Place project skills in `.opencode/skills/<name>/SKILL.md`.
   - Start `SKILL.md` with YAML frontmatter containing at least `name` and `description`.
   - Make the directory name match the `name` field exactly.
4. Keep the skill focused on the actual workflow the user asked for.
5. If the skill should load other tools, commands, or files, state that clearly in the instructions.

## Output Expectations

- Be concise.
- Preserve the user's requested intent.
- Prefer a reusable skill that can be loaded directly by name.
