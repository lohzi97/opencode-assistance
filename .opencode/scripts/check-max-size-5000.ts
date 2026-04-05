/**
 * File Size Check Script
 * 
 * Validates that a specified file does not exceed the maximum allowed size limit.
 * This is typically used as a pre-commit hook or build-time check to prevent
 * large files from being committed or processed.
 * 
 * Usage Instructions:
 * Run this script from the command line with the file path as an argument:
 * `bun run .opencode/scripts/check-max-size.ts <file_path>`
 * 
 * Command Line Arguments:
 * - file_path (required): The absolute or relative path to the file to check
 * 
 * Expected Behavior:
 * - If no file path is provided: Outputs "Missing file path argument" and exits with code 1
 * - If file does not exist: Outputs "File not found: <file_path>" and exits with code 1
 * - If file exceeds max size (50,000 bytes): Outputs file size and limit, exits with code 1
 * - If file is within limit: Exits silently with code 0 (success)
 * 
 * Size Limit:
 * - Maximum allowed file size: 50,000 bytes (approximately 48.8 KB)
 * - This limit is hardcoded and can be modified in the script by changing the `max` variable
 * 
 * Example Usage:
 * ```bash
 * # Check a specific file
 * bun run .opencode/scripts/check-max-size.ts ./dist/bundle.js
 * 
 * # Use in package.json scripts
 * "check-size": "bun .opencode/scripts/check-max-size.ts ./dist/bundle.js"
 * 
 * # Use as pre-commit hook (in .git/hooks/pre-commit)
 * bun run .opencode/scripts/check-max-size.ts ./dist/bundle.js
 * ```
 * 
 * Exit Codes:
 * - 0: File is within size limit (success)
 * - 1: Error occurred (missing argument, file not found, or file too large)
 */

async function main() {
  const file = process.argv[2];
  const max = Number(5000); // bytes

  if (!file) {
    console.error("Missing file path argument");
    process.exit(1);
  }

  const src = Bun.file(file);
  if (!(await src.exists())) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  if (src.size <= max) process.exit(0);

  console.error(`File exceeds max size: ${file}`);
  console.error(`Size: ${src.size} bytes`);
  console.error(`Limit: ${max} bytes`);
  process.exit(1);
}

if (import.meta.main) await main();
