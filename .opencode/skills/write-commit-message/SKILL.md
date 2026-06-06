---
name: write-commit-message
description: Generate commit messages for staged git changes. Use when the user asks to generate, write, draft, or suggest a commit message.
---

# Write Commit Message

Generate a commit message for the currently staged changes.

## Required Checks

1. Inspect staged changes:

   ```bash
   git diff --staged
   ```

2. Inspect staged file names:

   ```bash
   git diff --staged --name-only
   ```

3. If there are no staged changes, stop and tell the user there is nothing staged.

4. If file contents are needed to understand intent, read only the relevant files.

5. Do not create the commit unless the user explicitly asks you to commit.

## Output Contract

Output only the proposed commit message in one Markdown code block. Do not add explanation, commentary, or commit instructions after the code block.

## Format

```text
<type>[optional scope]: <short description> [optional issue-no]

- Detailed change point 1
- Detailed change point 2
- Detailed change point 3
```

## Subject Rules

- Use lowercase Conventional Commit type.
- Use an optional lowercase scope in parentheses.
- Keep the description concise, preferably 50 characters or fewer.
- Use imperative mood: `Add`, not `Adds` or `Added`.
- Do not end the subject with a period.
- Include issue numbers only when they are visible in the staged changes or explicitly provided.

## Body Rules

- Use bullet points beginning with `- `.
- Explain what changed and why it matters.
- Avoid implementation trivia unless it is essential to the change meaning.
- Use imperative mood for each bullet.
- Group related changes together.
- Include OpenSpec task/spec updates when they are part of the staged changes.

## Type Selection

Use these generic types when the staged changes are not an OpenSpec artifact-only checkpoint:

- `feat`: A new user-facing or system capability.
- `fix`: A bug fix or behavior correction.
- `docs`: Documentation-only changes.
- `style`: Formatting, whitespace, or lint-only changes.
- `refactor`: Code restructuring without behavior change.
- `perf`: Performance improvement.
- `test`: Test additions or corrections.
- `chore`: Maintenance, tooling, build, config, or dependency work.

Prefer the type that describes the primary user-visible or operational effect of the staged changes.

## OPSX/OpenSpec Type Policy

Use a stable OpenSpec commit type for OpenSpec artifact-only checkpoints:

```text
docs(openspec): <description>
```

Use `docs(openspec)` when all meaningful staged changes are OpenSpec or OPSX planning artifacts, including:

- New or reviewed proposal artifacts under `openspec/changes/**`.
- Proposal alignment updates from `opsx-align`.
- Archive moves from `opsx-archive`, including `openspec/changes/archive/**`.
- Main spec synchronization under `openspec/specs/**` during archive.
- PRD decomposition artifacts, including `prd-implementation-sequence.md`.
- OpenSpec testing or code-review notes such as `issue.md`.
- Task checklist updates in `tasks.md`.

Recommended OpenSpec subjects:

- `docs(openspec): Add proposal for <change-name>`
- `docs(openspec): Review proposal for <change-name>`
- `docs(openspec): Align proposal for <change-name>`
- `docs(openspec): Archive completed change <change-name>`
- `docs(openspec): Add PRD decomposition for <project-or-feature>`
- `docs(openspec): Record test findings for <change-name>`

If staged changes mix implementation code and OpenSpec artifacts, choose the implementation type (`feat`, `fix`, `refactor`, `test`, etc.) unless the implementation changes are incidental to the OpenSpec artifact checkpoint. Mention the OpenSpec updates in the body.

Do not use `chore`, `refactor`, or `feat` for OpenSpec artifact-only commits. This keeps OPSX checkpoints consistent across proposal, alignment, and archive phases.

## Scope Guidance

- Use `openspec` for OpenSpec artifact-only commits.
- Use a product or subsystem scope for implementation commits when obvious.
- Omit scope if no concise, accurate scope exists.

## Examples

```text
docs(openspec): Align proposal for agent-collab rooms

- Update proposal artifacts to match the completed room bootstrap behavior
- Clarify archive sync expectations for room summary follow-up work
- Mark alignment tasks as complete
```

```text
docs(openspec): Archive completed change add-room-summary

- Move the completed change into the dated archive directory
- Sync accepted requirements into the main OpenSpec specs
- Validate the archived spec tree
```

```text
feat(agent-collab): Add room summary retrieval

- Add summary storage for completed collaboration rooms
- Expose room summary retrieval through the CLI
- Update OpenSpec tasks for the implemented capability
```
