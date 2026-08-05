---
name: antigravity-image
description: Generate, edit, recolor, and export images with Antigravity CLI (agy) through agent-tui. Use when creating image assets for a build, drawing visual explanations, mockups, or diagrams, or modifying an existing image.
---

# Antigravity Image

## When to use me

Use this skill for image generation and image-to-image editing through Antigravity CLI. Typical requests include:

- Creating image assets for an application, website, presentation, or prototype.
- Drawing an illustration, diagram, mockup, or other visual explanation for the Master.
- Modifying an existing image, such as recoloring hair, changing clothing, removing an object, or preserving a scene while changing one detail.

This skill uses Antigravity's built-in image tool through the `agent-tui` terminal workflow. Do not substitute another image service without asking the Master.

## Hard prerequisites

1. Load the `agent-tui` skill before interacting with the terminal UI.
2. Verify that both `agent-tui` and `agy` are installed and available in `PATH`.
3. Start Antigravity and verify that it is already authenticated before submitting a prompt.
4. If `agy` is missing, Antigravity is not authenticated, or a login/OAuth prompt appears, stop and ask the Master to install or authenticate it interactively. Never automate the login or OAuth flow.
5. For an edit, verify that the original image exists and use an absolute path. Do not overwrite the original unless the Master explicitly requests it.

## Session lifecycle

Only one active `agent-tui` session is supported by default.

1. Check for existing sessions with `agent-tui sessions list`.
2. If an existing session is stale, kill it before starting. If it appears to be in active use by the Master, ask before killing it.
3. Start the daemon and launch Antigravity:

```bash
agent-tui daemon start 2>&1
agent-tui run agy 2>&1
```

Record the returned session ID and target every subsequent command with `-s <session-id>`.

4. Take a screenshot and confirm the `>` input prompt, an authenticated account, and a model indicator. Stop if the screen requests login.
5. Always kill the session when finished and verify `agent-tui sessions list` reports no active sessions:

```bash
agent-tui -s <session-id> kill 2>&1
agent-tui sessions list 2>&1
```

## Generate an image

Write a concrete prompt that specifies the subject, action, style, composition, aspect ratio, lighting, and any text requirements. For a visual explanation, state what relationships or labels the image must communicate.

Example prompt:

```text
Generate an image of an anime girl with long pink hair standing on a Tokyo street at sunset, cherry blossoms in the foreground, polished anime illustration style, portrait composition, and no watermark.
```

Submit it through the active session:

```bash
agent-tui -s <session-id> type "<prompt>" 2>&1
agent-tui -s <session-id> press Enter 2>&1
```

Wait for generation to finish before interpreting the result. Look for and wait out `Working...`, `Generating...`, or equivalent loading indicators. Then capture the response:

```bash
agent-tui -s <session-id> wait -t 120000 "Working..." 2>&1
agent-tui -s <session-id> wait -t 120000 "Working..." --gone 2>&1
agent-tui -s <session-id> resize --cols 200 --rows 300 2>&1
agent-tui -s <session-id> screenshot --strip-ansi 2>&1
```

Confirm that Antigravity invoked a `GenerateImage(...)` tool. If it only describes an image without invoking the tool, ask once: `Use the image generation tool and produce the image, not just a text description.`

## Modify an existing image

Use an `@` reference with the original path, preferring `~/` for files under the user's home directory. Be explicit about the single intended change and enumerate details that must remain unchanged.

Example:

```text
Modify the attached original image @~/Downloads/anime-girl.png. Change only the anime girl's hair color from pink to natural black. Preserve the hairstyle, face, eyes, expression, pose, hands, clothing, accessories, background, lighting, shadows, composition, and image dimensions. Generate the edited image.
```

For a project asset, prefer the project's asset directory as the destination. For an exploratory image, use a new descriptive file in `~/Downloads/`. Keep the original filename and output filename different.

## Export and verify the file

The generated binary may initially be stored in Antigravity's internal directory, usually under:

```text
~/.gemini/antigravity-cli/brain/<run-id>/<image-name>.<extension>
```

The TUI may show only the `GenerateImage(...)` call and a text summary. Do not report success based on that summary alone. Ask Antigravity to export the result to the exact requested path:

```text
Please save the generated or modified image as ~/Downloads/<output-name>.png and verify that the file exists.
```

If Antigravity requests permission to run a Bash/Python export command:

1. Expand the command with `Ctrl+O` and, if needed, enlarge the viewport with `agent-tui resize`.
2. Approve only when the source is the generated image and the destination is the exact requested output path.
3. Decline commands that delete, overwrite an unintended file, upload data, or access unrelated paths.
4. Approve a subsequent `ls` or equivalent check only when it checks the requested output path.

Finally, verify the output exists and inspect it with the available file/image reading tools. Do not claim that an image was created until the output file exists and has been inspected.

## Failure and reporting

- Stop and ask the Master if Antigravity is unavailable, unauthenticated, or asks for interactive login.
- If generation fails or no image tool call appears after the one explicit retry, report the exact limitation rather than inventing an output.
- Generative edits are not guaranteed to be pixel-identical. Report that caveat when the request requires preserving an original image.
- Report the final path, image format/size when available, what was generated or changed, and any fidelity caveat.
