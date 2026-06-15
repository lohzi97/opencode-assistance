---
name: browser-interact
description: Interact with any website by driving a real Chrome browser through the desktop-control workflow. Use when a site needs JavaScript, anti-bot-sensitive human-like browsing, form interaction, page exploration, or other browser work beyond static fetches.
---

# Browser Interact — Human-like Web Interaction

## When to Use

Use whenever you need to interact with a website beyond what `webfetch` can do. This includes:

- Reading JS-rendered pages
- Human-like browsing on anti-bot-sensitive sites
- Navigating websites and menus
- Filling forms and logging in
- Multi-step web workflows
- Exploring dynamic content

Do NOT use this skill for development inspection of your own site. That is a separate browser/devtools workflow.

## Prerequisites

1. Load `computer-control-guide` immediately.
2. Start Chrome with the `chrome` skill if it is not already running.
3. If either requirement is unavailable, stop and report it.

## Rules

1. Follow the `verify -> act -> verify` loop from `computer-control-guide` for every browser action.
2. Prefer Chrome keyboard shortcuts over mouse actions whenever possible.
3. Use address-bar navigation when direct link clicking is awkward or imprecise.
4. For anti-bot challenges, attempt at most once. If it fails, stop and ask Master to solve it manually.

## Core Workflows

### 1. Start Chrome
Load the `chrome` skill and follow its startup procedure to ensure Chrome is running on port 9222.

### 2. Navigate to a URL
1. Verify the desktop state.
2. Activate Chrome.
3. Use `Ctrl+L` to focus the address bar.
4. Type the URL.
5. Press `Enter`.
6. Wait briefly and verify the page loaded.

### 3. Handle Popups and Dialogs
Browser permission popups, cookie banners, notification prompts, and modal dialogs can block the page.

- First try keyboard paths such as `escape`, `tab`, `shift+tab`, and `enter`.
- If the dialog requires a click, calibrate the mouse, verify the cursor on target, then click.
- Verify that the page is clear before continuing.

### 4. Check for Anti-Bot Challenges
Inspect the page for:

- Cloudflare browser checks
- reCAPTCHA or hCaptcha
- "Verify you are human" turnstiles

If you see a challenge:
1. Attempt to solve it once using the verified mouse workflow.
2. Verify whether it passed.
3. If it did not pass, stop and ask Master to solve it manually.
4. Do not retry and do not attempt workarounds.

### 5. Read Page Content Top to Bottom
1. Start from the top of the page.
2. Verify the visible content.
3. Use `pagedown` to scroll one viewport at a time.
4. Verify after each scroll.
5. Continue until the footer is visible and further scrolling no longer changes the page.
6. Read everything; do not skip sections.

### 6. Explore a Website
To understand a full website:

1. Verify the top navigation.
2. Plan a visit order for top-level pages.
3. For each destination page:
   - Prefer keyboard navigation if the menu is focusable.
   - Otherwise calibrate the mouse, verify cursor placement, and click.
   - Wait for load and verify the destination page.
   - Read the page top-to-bottom.
   - Write a summary to `/tmp/opencode/<page-name>.md` with sections, links, buttons, and key findings.
4. Read all temp notes and synthesize the site understanding.

### 7. Fill Forms and Type into Input Fields
1. Verify the target field is visible.
2. Click once if focus is uncertain.
3. Verify focus.
4. Type in short chunks.
5. Verify the entered text.
6. Submit with `enter` if possible; otherwise use a verified click.

### 8. Click Buttons and Links
1. Verify the element location.
2. Move the mouse onto the element and verify cursor placement.
3. Click only after verification.
4. Wait for the result.
5. Verify the new page state.

### 9. Report Findings
After completing the interaction, provide a comprehensive summary of what was found, read, or accomplished.

## Chrome Shortcut Reference

- Focus address bar: `Ctrl+L`
- New tab: `Ctrl+T`
- Reopen closed tab: `Ctrl+Shift+T`
- Close tab: `Ctrl+W`
- Close window: `Ctrl+Shift+W`
- Refresh: `Ctrl+R`
- Hard refresh: `Ctrl+Shift+R`
- Find in page: `Ctrl+F`
- Scroll top: `home`
- Scroll bottom: `end`
- Scroll by viewport: `pagedown`, `pageup`

## Exploration Guidance

- Use the address bar when you know the target URL.
- Use the site navigation when you need to understand site structure.
- When a menu has dropdowns, hover or focus the parent item first, then verify the submenu before continuing.
- Keep notes per page while exploring larger sites so findings are not lost between pages.

Keep the general mouse-calibration, screenshot, typing, and verification doctrine in `computer-control-guide`.
