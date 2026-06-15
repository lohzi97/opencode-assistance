---
name: computer-control-guide
description: General operating doctrine for controlling the desktop with computer-control tools. Use ALWAYS before any GUI task that uses computer-control, including browsers, desktop apps, dialogs, screenshots, typing, clicking, scrolling, or drag operations.
---

# Computer Control Guide

## When to Use

Load this skill before any task that uses computer-control tools.

This is the baseline skill for whole-desktop control. Browser-specific guidance belongs in `browser-interact`.

## Rules

1. Every action follows `verify -> act -> verify`.
2. Prefer full-desktop screenshots over OCR screenshots when checking machine state.
3. When taking screenshots for interaction, always include the cursor.
4. Prefer keyboard operations over mouse operations whenever a keyboard path is available.
5. Never send long text in a single `type_text` call. Break it into short chunks and verify between chunks.
6. Before any click, move the mouse first, take a screenshot, confirm the cursor is on target, then click.
7. Recalibrate mouse position whenever the cursor lands off target.
8. Activate the correct window before interacting.
9. Wait briefly after actions that change UI state, then verify the result.
10. If a computer-control action fails or times out, stop and report it instead of guessing.

## Standard Loop

1. Verify current state with a full-desktop screenshot.
2. Activate the target window if needed.
3. Choose keyboard over mouse if possible.
4. If mouse is required, move first and verify cursor placement.
5. Perform one action only.
6. Verify the result with another screenshot.

## Screenshot Practice

- Preferred state check:

```text
computer-control_take_screenshot({
  "title_pattern": "",
  "show_cursor": true,
  "save_to_downloads": false,
  "use_regex": false,
  "threshold": 10,
  "scale_percent_for_ocr": 100,
  "use_wgc": false
})
```

- Use OCR screenshots only as a secondary aid when exact text extraction is needed after the visual state is already understood.

## Mouse Workflow

Use mouse only when keyboard is not enough.

1. Identify the target from a full-desktop screenshot.
2. Move the mouse near the target.
3. Take another full-desktop screenshot with cursor visible.
4. Adjust until the cursor is visually on the target.
5. Click only after confirmation.

Example:

```text
computer-control_move_mouse({"x": 520, "y": 410})
computer-control_take_screenshot({"title_pattern": "", "show_cursor": true, "save_to_downloads": false, "use_regex": false, "threshold": 10, "scale_percent_for_ocr": 100, "use_wgc": false})
computer-control_click_screen({"x": 520, "y": 410})
computer-control_take_screenshot({"title_pattern": "", "show_cursor": true, "save_to_downloads": false, "use_regex": false, "threshold": 10, "scale_percent_for_ocr": 100, "use_wgc": false})
```

## Typing Workflow

Before typing:

1. Verify the intended field is visible.
2. Click into the field if focus is uncertain.
3. Verify focus.
4. Type in short chunks.
5. Verify the text appeared correctly.

Example:

```text
computer-control_click_screen({"x": 560, "y": 690})
computer-control_take_screenshot({"title_pattern": "", "show_cursor": true, "save_to_downloads": false, "use_regex": false, "threshold": 10, "scale_percent_for_ocr": 100, "use_wgc": false})
computer-control_type_text({"text": "First short sentence."})
computer-control_take_screenshot({"title_pattern": "", "show_cursor": true, "save_to_downloads": false, "use_regex": false, "threshold": 10, "scale_percent_for_ocr": 100, "use_wgc": false})
computer-control_type_text({"text": " Second short sentence."})
```

For long prompts, send multiple short `type_text` calls rather than one large block.

## Keyboard Practice

Use `computer-control_press_keys` with the correct shape.

Important distinction:

- `{"keys": ["ctrl", "l"]}` means press `ctrl`, then press `l` as separate actions.
- `{"keys": [["ctrl", "l"]]}` means press `Ctrl+L` as a key combination.

- Single special key:

```text
computer-control_press_keys({"keys": "enter"})
computer-control_press_keys({"keys": "pagedown"})
computer-control_press_keys({"keys": "pageup"})
computer-control_press_keys({"keys": "home"})
computer-control_press_keys({"keys": "end"})
computer-control_press_keys({"keys": "escape"})
```

- Repeated plain keys:

```text
computer-control_press_keys({"keys": ["tab", "tab", "enter"]})
computer-control_press_keys({"keys": ["down", "down", "right"]})
```

- Key combinations:

```text
computer-control_press_keys({"keys": [["ctrl", "l"]]})
computer-control_press_keys({"keys": [["ctrl", "a"]]})
computer-control_press_keys({"keys": [["ctrl", "c"], ["ctrl", "v"]]})
computer-control_press_keys({"keys": [["ctrl", "shift", "w"]]})
computer-control_press_keys({"keys": [["ctrl", "alt", "delete"]]})
```

Notes:

- `pagedown` and `pageup` are single key strings, not two-key combinations.
- Arrow keys are `up`, `down`, `left`, `right`.
- Use repeated `tab` or arrow keys when a keyboard path is more precise than clicking.

## Window Control

Typical window-first sequence:

```text
computer-control_list_windows({})
computer-control_activate_window({"title_pattern": "Google Chrome", "use_regex": false, "threshold": 60})
computer-control_take_screenshot({"title_pattern": "", "show_cursor": true, "save_to_downloads": false, "use_regex": false, "threshold": 10, "scale_percent_for_ocr": 100, "use_wgc": false})
```

## Waiting and Verification

- After navigation, dialog dismissal, or submission, wait briefly before verifying.

```text
computer-control_wait_milliseconds({"milliseconds": 1000})
computer-control_take_screenshot({"title_pattern": "", "show_cursor": true, "save_to_downloads": false, "use_regex": false, "threshold": 10, "scale_percent_for_ocr": 100, "use_wgc": false})
```

Use longer waits only when the UI genuinely needs it.

## Common Failure Patterns

- Blind clicking without verifying cursor placement
- Typing without confirming focus
- Sending long text in one call
- Using OCR screenshots as the primary state check
- Forgetting to activate the target window
- Performing multiple UI actions before verifying the previous one

If any of these happen, reset to the standard loop and proceed one verified action at a time.
