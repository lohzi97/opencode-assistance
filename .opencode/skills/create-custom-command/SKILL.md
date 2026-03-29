---
name: create-custom-command
description: Create an OpenCode custom command from completed work by summarizing the work, consulting the command docs, and writing the command file.
---

# Create Custom Command

## When to Use

Use this skill when the user says something like: "Based on what you have done, create a xxx custom command for it."

## Workflow

1. Summarize what you have done into concise but detailed steps.
2. Read the OpenCode custom command documentation before writing anything.
   - Use the official commands guide: `https://opencode.ai/docs/commands/`
   - Inspect an existing command file in the project if one is available.
3. Create the custom command based on the documentation.
   - Place per-project commands in `.opencode/commands/<name>.md`.
   - Use YAML frontmatter with at least `description`.
   - Make the filename match the slash command name.
4. Keep the command prompt focused on the actual workflow the user asked for.
5. If the command needs to write or update files, include that explicitly in the prompt.

## Output Expectations

- Be concise.
- Preserve the user's requested intent.
- Prefer a reusable command that can be invoked directly from `/command-name`.
