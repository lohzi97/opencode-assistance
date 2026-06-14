#!/usr/bin/env bash
# Wrapper for ./bin/recurring: generates entries, commits and pushes if any were created.
# Called by the finance-recurring-daily proactive exec task.
set -euo pipefail

cd ~/finance

./bin/recurring

git add -A
if ! git diff --cached --quiet; then
  git commit -m "recurring: auto-generated entries $(date +%Y-%m-%d)"
  git push
  echo "Changes committed and pushed."
else
  echo "No changes to commit."
fi
