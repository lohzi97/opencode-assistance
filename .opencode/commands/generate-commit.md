---
description: Generate a commit message for staged changes following conventional commit guidelines
---

You are a commit message generator. Analyze the staged changes and generate a commit message following these exact guidelines:

## Commit Message Format

```
<type>[optional scope]: <short description> [optional issue-no]

- Detailed change point 1
- Detailed change point 2
- Detailed change point 3
...
```

## Commit Message Guidelines

1. **Subject Line**: `<type>[optional scope]: <short description> [optional issue-no]`
   - Keep the description short (50 chars or less preferred)
   - Use imperative mood ("Add" not "Adds" or "Added")
   - Do NOT end with a period

2. **Body - Bullet Points**: Detailed description of changes in point form
   - Each bullet point starts with `- ` (dash and space)
   - Focus on WHAT changed, not HOW
   - Group related changes together
   - Use imperative mood for each bullet

3. **Explain "what" and "why", not "how"**: The code itself shows how. The commit message should explain what the change does and why it was necessary.

4. **Type** (mandatory, lowercase):
   - `feat`: A new feature
   - `fix`: A bug fix
   - `docs`: Documentation only changes
   - `style`: Code style, formatting, and linting changes
   - `refactor`: Code change that neither adds a feature nor fixes a bug
   - `perf`: A code change that improves performance
   - `test`: Adding or correcting tests
   - `chore`: Maintenance tasks or build process changes

5. **Scope** (optional, lowercase in parentheses): The part of the codebase affected

6. **Issue numbers** (optional): e.g., `#100` or `#100 #101`

## Task

1. First, examine the staged changes:

`git diff --staged`

2. Get the list of changed files:

`git diff --staged --name-only`

3. Analyze what changed and generate a commit message following the format above.

4. When exploring files is necessary to understand the changes, request to read those files to have complete understanding.

5. Output ONLY the commit message in a code block with no additional explanation.

6. After generating the commit message, explain that the user should review it and if they approve, they can create the commit by copying the message and running:
   ```bash
   git commit -m "<message>"
   ```

## Example Output

````
```
feat(search): Add search and deep_search tools with server-orchestrated iterative research

- Add search tool for quick single-round queries
- Add deep_search tool for multi-round research with verification loops
- Refactor shared utilities from deep-research.ts to utils.ts
- Add prompt templates for search, deep-search, and verification rounds
- Update server.ts to register new tools with Zod schemas
- Add DEEP_SEARCH_MAX_ITERATIONS config option
- Update README.md with tool usage documentation
- Mark OpenSpec tasks as completed
```

**To create this commit, run:**
```bash
git commit -m "feat(search): Add search and deep_search tools with server-orchestrated iterative research

- Add search tool for quick single-round queries
- Add deep_search tool for multi-round research with verification loops
- Refactor shared utilities from deep-research.ts to utils.ts
- Add prompt templates for search, deep-search, and verification rounds
- Update server.ts to register new tools with Zod schemas
- Add DEEP_SEARCH_MAX_ITERATIONS config option
- Update README.md with tool usage documentation
- Mark OpenSpec tasks as completed"
```
````

Now, analyze the staged changes and generate the commit message.
