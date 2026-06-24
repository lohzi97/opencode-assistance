#!/usr/bin/env bun

/**
 * File Size Check Script (parametric)
 *
 * Validates that a file does not exceed a maximum size. Intended as a
 * `file-check.jsonc` rule script: `bun check-max-size.ts --limit N <file>`.
 * The limit defaults to 25000 bytes when `--limit` is omitted.
 *
 * Usage:
 *   bun run .opencode/scripts/check-max-size.ts --limit 25000 <file_path>
 *
 * Exit codes:
 * - 0: file is within the limit
 * - 1: missing argument, file not found, or file too large
 */

function parseArgs(argv: string[]) {
  let limit = 25000;
  let file: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") {
      const next = argv[++i];
      const value = Number(next);
      if (!Number.isFinite(value) || value <= 0) {
        console.error("--limit must be a positive number");
        process.exit(1);
      }
      limit = value;
      continue;
    }
    file = arg;
  }

  return { limit, file };
}

async function main() {
  const { limit, file } = parseArgs(process.argv.slice(2));

  if (!file) {
    console.error("Missing file path argument");
    process.exit(1);
  }

  const src = Bun.file(file);
  if (!(await src.exists())) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  if (src.size <= limit) process.exit(0);

  console.error(`File exceeds max size: ${file}`);
  console.error(`Size: ${src.size} bytes`);
  console.error(`Limit: ${limit} bytes`);
  process.exit(1);
}

if (import.meta.main) await main();
