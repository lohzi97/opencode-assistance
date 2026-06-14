---
name: browser-interact
description: Interact with any website by driving a real Chrome browser through computer-control MCP — read JS-rendered content, navigate, fill forms, click buttons, log in, and complete multi-step web workflows like a human user. Use when webfetch fails or returns blank content, when a site needs JavaScript to render, when anti-bot measures block automated access, or when you need to perform human-like browser interaction (clicking, typing, scrolling, form submission).
---

# Browser Interact — Human-like Web Interaction

## When to Use

Use whenever you need to interact with a website beyond what `webfetch` can do. This includes:

- **Reading JS-rendered content** — SPAs (React, Vue, Angular), client-side rendered pages where `webfetch` returns blank or incomplete HTML
- **Bypassing anti-bot protection** — Cloudflare, DataDome, PerimeterX, or sites that block non-browser clients
- **Navigating websites** — clicking menu links, exploring pages, understanding site structure
- **Filling forms and logging in** — typing into input fields, submitting forms, authenticating
- **Multi-step web workflows** — any sequence of clicks, typing, and scrolling that a human would perform
- **Scraping dynamic content** — data that loads on scroll, interaction, or timer

**Do NOT use for** simple static pages where `webfetch` succeeds — this skill is slower and more resource-intensive.

## Prerequisites

1. Chrome must be running in remote debugging mode — use the `chrome` skill to start it.
2. `computer-control` MCP must be available.
3. If either is missing, report to user immediately. Do not substitute.

## Rules

1. **Always take FULL DESKTOP screenshots** — never screenshot a single window (do not use `title_pattern`). You need the complete desktop view to know the true coordinates of buttons, links, and elements for mouse interaction.
2. **Always use `show_cursor: true`** when taking screenshots so you can verify the mouse position visually.
3. **Calibrate before clicking** — there is an offset between coordinates passed to `computer-control_move_mouse` and where the cursor actually appears on screen. You MUST iteratively move-screenshot-adjust until the cursor is visually on the target before clicking.
4. **Click before typing** — always click on a text input field, address bar, or search box once to activate it before typing text.
5. **Use `pagedown` as a single key string** — do not pass it as a key combination like `["page", "down"]`.
6. **CAPTCHA / Anti-bot challenge policy** — attempt to solve at most ONCE. If the attempt fails, STOP immediately, inform the user, and let them solve it manually. Never retry repeatedly — this risks getting flagged as a bot.

## Core Workflows

### 1. Start Chrome
Load the `chrome` skill and follow its startup procedure to ensure Chrome is running on port 9222.

### 2. Navigate to a URL
1. Take a full desktop screenshot to see the current state.
2. Activate the Chrome window: `computer-control_activate_window` with `title_pattern: "Chrome"`.
3. Click the address bar: `Ctrl+L` (`computer-control_press_keys` with `[["ctrl", "l"]]`).
4. Type the URL: `computer-control_type_text` with the target URL.
5. Press `Enter` to navigate.
6. Wait 3-5 seconds for the page to load: `computer-control_wait_milliseconds`.

### 3. Handle Popups and Dialogs
Browser permission popups (e.g., "wants to access...", cookie banners, notification prompts) can block content. Clear them before proceeding:

- Press `Escape` to dismiss generic modals/popups.
- If a popup has Block/Allow buttons, move the mouse to the button, screenshot to verify position, then click.
- Take a screenshot after dismissing to confirm the page is now clear.

### 4. Check for Anti-Bot Challenges
After the page loads, take a screenshot and inspect it for:

- **Cloudflare "Checking your browser"** interstitial
- **Google reCAPTCHA** or hCaptcha challenges
- **"Verify you are human"** turnstiles

If you see a challenge:
1. **Attempt to solve it ONCE** — move mouse to the checkbox/button, screenshot to verify, click, and wait.
2. Take a screenshot to check if it passed.
3. **If it did not pass, STOP.** Inform the user: *"I have encountered a [Cloudflare/reCAPTCHA] challenge at [URL]. I attempted it once but it did not pass. Please solve it manually in the browser, then let me know to continue."*
4. Do NOT retry. Do NOT attempt workarounds.

### 5. Read Page Content (Top to Bottom)
1. Take a full desktop screenshot with `show_cursor: true` to capture the top of the page.
2. Press `pagedown` to scroll down one viewport.
3. Take another screenshot.
4. Repeat until you reach the bottom of the page (the footer is visible and scrolling no longer changes the view).
5. After each screenshot, note what content you see — headings, text, images, links, buttons, forms.

### 6. Navigate the Main Menu (Full Website Exploration)
To understand a complete website, identify the main navigation menu and visit each page:

1. Take a screenshot of the top of the page to see the menu.
2. Plan a visit order for all top-level menu items (e.g., Home, About, Services, Products, Contact).
3. For each menu item:
   a. **Calibrate the mouse** — move mouse toward the menu item, screenshot, adjust coordinates, repeat until the cursor is visually on the link.
   b. Click the link.
   c. Wait 3 seconds for page load.
   d. Screenshot and scroll through the entire page (Step 5).
   e. Write a summary of the page to `/tmp/opencode/<page_name>.md` including all content sections, links, and buttons found.
4. After visiting all pages, read all temp files and synthesize a complete understanding of the website.

### 7. Fill Forms and Type into Input Fields
To type into any text field, search box, or login form:

1. Take a screenshot to locate the target input field.
2. **Calibrate the mouse** onto the input field (see Coordinate Calibration below).
3. **Click once** on the field to activate it (a blinking cursor should appear).
4. Take a screenshot to confirm the field is activated.
5. Type the text: `computer-control_type_text`.
6. To submit, either press `Enter` or calibrate-and-click the submit button.

### 8. Click Buttons and Links
To click any visible element:

1. Take a screenshot to locate the element.
2. **Calibrate the mouse** onto the element — move, screenshot, adjust, repeat.
3. Confirm the cursor is on the target via screenshot.
4. Click: `computer-control_click_screen`.
5. Wait for any resulting page load or UI change.
6. Take a screenshot to verify the result.

### 9. Report Findings
After completing the interaction, provide a comprehensive summary of what was found, read, or accomplished.

## Coordinate Calibration (Critical)

There is a **consistent offset** between coordinates passed to `computer-control_move_mouse` / `computer-control_click_screen` and where the cursor actually appears in the screenshot. This offset varies by environment and cannot be pre-calculated.

**Calibration procedure:**
1. Pick your target coordinates from a screenshot (e.g., a button at x=280, y=130 in the screenshot).
2. Guess an offset and move the mouse (e.g., pass x=420, y=150).
3. Take a screenshot with `show_cursor: true`.
4. Observe where the cursor actually landed.
5. Calculate the true offset: `passed_coords - actual_coords`.
6. Adjust and repeat until the cursor is on the target.
7. **Only then** click.

**Example loop:**
```
Target: x=280, y=130 (from screenshot)
Attempt 1: pass x=420, y=150 → cursor lands at x=230, y=120
  → offset is roughly x=190, y=30
Attempt 2: pass x=470, y=160 → cursor lands at x=250, y=125
  → offset is roughly x=220, y=35
Attempt 3: pass x=500, y=165 → cursor lands at x=270, y=125
  → Close enough, or refine one more time
Click at x=500, y=165.
```

Never skip this calibration. Clicking blind will miss targets and waste turns.

## Key Gotchas

- **`pagedown` not `["page", "down"]`** — Page Down is a single key, not a key combination.
- **`home` to scroll to top** — useful when navigating between pages.
- **Dropdown menus** — some nav items have dropdown submenus (indicated by a `v` or arrow). Hovering reveals sub-items. Move the mouse to the submenu item and click to navigate to subpages.
- **Address bar navigation** — if clicking a menu item fails after calibration, use `Ctrl+L` in the address bar and type the URL directly (e.g., `https://example.com/about/`).
- **Full desktop screenshots only** — using `title_pattern` to screenshot a single window hides the true cursor coordinates and breaks mouse interaction. Always omit `title_pattern` for screenshots during this workflow.
- **Wait after actions** — after clicking, typing, or navigating, wait 2-5 seconds and screenshot to confirm the result before proceeding.
