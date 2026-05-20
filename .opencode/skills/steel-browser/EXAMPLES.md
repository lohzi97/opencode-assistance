# Steel Browser Examples

## Example 1: Simple Read-Only Extraction

```bash
steel scrape https://example.com --format markdown --api-url http://localhost:3000/v1
```

Use this first when Master wants rendered page content and no interaction is needed.

## Example 2: Readability Plus Markdown

```bash
steel scrape https://example.com/article --format readability,markdown --api-url http://localhost:3000/v1
```

Use this when article text matters more than page chrome.

## Example 3: Screenshot To `/tmp`

```bash
SESSION="sebastian-example-screenshot-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser screenshot /tmp/steel-example.png --full --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

Use this when Master explicitly needs an image artifact.

## Example 4: PDF To `/tmp`

```bash
SESSION="sebastian-example-pdf-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser pdf /tmp/steel-example.pdf --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

Use this when Master explicitly needs a PDF artifact.

## Example 5: Minimal Interactive Session

```bash
SESSION="sebastian-example-flow-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

## Example 6: Fill And Submit A Simple Form

```bash
SESSION="sebastian-login-check-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com/login --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser fill @e2 "user@example.com" --session "$SESSION" --api-url http://localhost:3000/v1
steel browser fill @e3 "correct horse battery staple" --session "$SESSION" --api-url http://localhost:3000/v1
steel browser click @e4 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

Replace the example element references with the actual refs from the latest snapshot.

## Example 7: Click Through And Capture Evidence

```bash
SESSION="sebastian-dashboard-audit-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser click @e1 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser wait --load networkidle --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser screenshot --full --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

## Example 8: Local Smoke Test

```bash
SESSION="smoke-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```
