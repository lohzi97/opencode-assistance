/**
 * Memory File Validation Script
 *
 * Validates that a canonical or private memory file conforms to the
 * Sebastian memory-layer format rules. Covers file size, heading
 * structure, bullet-entry shape, required metadata fields, date
 * formats, and content hygiene (no transcript quotes, no command
 * blocks, no fenced code, no raw URLs).
 *
 * Usage Instructions:
 * Run this script from the command line with the file path as an argument:
 * `bun run .opencode/scripts/validate-memory-file.ts <file_path>`
 *
 * Command Line Arguments:
 * - file_path (required): The absolute or relative path to the memory file to validate
 *
 * Expected Behavior:
 * - If no file path is provided: Outputs "Missing file path argument" and exits with code 1
 * - If file does not exist: Outputs "File not found: <file_path>" and exits with code 1
 * - If file exceeds 5 000 bytes: Outputs file size and limit, exits with code 1
 * - If validation errors are found: Outputs each error with its line number, exits with code 1
 * - If file passes all checks: Exits silently with code 0 (success)
 *
 * Validation Rules:
 * 1. File must not be empty
 * 2. First line must be a single markdown heading (e.g. "# Master Memory")
 * 3. No fenced code blocks (``` ```) are allowed
 * 4. Every non-empty body line must be a compact bullet entry starting with "- "
 * 5. Raw transcript-style quoting (lines starting with ">", "User:", "## Assistant", etc.) is rejected
 * 6. Command-like copied content (lines starting with /git/npm/etc.) is rejected
 * 7. Every bullet must carry required metadata tags: [scope: ...], [provenance: ...], [last-confirmed: ...]
 * 8. Date-valued fields ([last-confirmed:], [last-worked:]) must use YYYYMMDD format
 * 9. [notes:] metadata must be a repo-relative path, not a URL
 * 10. [path:] metadata must be an absolute path starting with "/"
 * 11. Inline URLs are only allowed for stable anchors (github, gitlab, docs, localhost, opencode)
 *
 * Size Limit:
 * - Maximum allowed file size: 5 000 bytes
 * - This limit is hardcoded and can be modified by changing the `MAX_BYTES` constant
 *
 * Example Usage:
 * ```bash
 * # Validate a single canonical memory file
 * bun run .opencode/scripts/validate-memory-file.ts memory/canonical/master.md
 *
 * # Use in a CI or pre-commit hook
 * for f in memory/canonical/*.md memory/private/*.md; do
 *   bun run .opencode/scripts/validate-memory-file.ts "$f" || exit 1
 * done
 * ```
 *
 * Exit Codes:
 * - 0: File passes all validation checks (success)
 * - 1: Error occurred (missing argument, file not found, file too large, or validation failure)
 */

const MAX_BYTES = 5000;
const ENTRY_LINE = /^- .+$/;
const REQUIRED_FIELDS = ["scope", "provenance", "last-confirmed"];
const DATE_RE = /^\d{8}$/;
const ALLOWED_TITLE_RE = /^# [A-Za-z0-9()\-`,.'/ ]+$/;
const STABLE_URL_RE = /^https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/;

type Failure = {
  line?: number;
  message: string;
};

function fail(list: Failure[], message: string, line?: number) {
  list.push({ line, message });
}

function hasTranscriptQuote(line: string) {
  return /^(>|\d+:\s|User:|Assistant:|## User|## Assistant|_Thinking:_)/.test(line.trim());
}

function hasCommandBlock(line: string) {
  return /^\s*(\/\w+\b|`?(git|npm|bun|uv|python|python3|node|docker|kubectl|qmd|gh)\b)/i.test(
    line.trim(),
  );
}

function extractMeta(line: string) {
  return Array.from(line.matchAll(/\[([a-z-]+):\s*([^\]]+)\]/g)).map((match) => ({
    key: match[1],
    value: match[2].trim(),
  }));
}

function validateTitle(lines: string[], failures: Failure[]) {
  if (lines.length === 0) {
    fail(failures, "memory file must not be empty");
    return;
  }

  const first = lines[0].trim();
  if (!ALLOWED_TITLE_RE.test(first)) {
    fail(failures, "first line must be a single markdown heading", 1);
  }
}

function validateLine(line: string, number: number, failures: Failure[]) {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("```")) {
    fail(failures, "fenced code blocks are not allowed in canonical or private memory", number);
    return;
  }

  if (number === 1 && trimmed.startsWith("# ")) return;

  if (!ENTRY_LINE.test(trimmed)) {
    fail(failures, "non-empty body lines must be compact bullet entries", number);
    return;
  }

  const body = trimmed.slice(2);
  if (hasTranscriptQuote(body)) {
    fail(failures, "raw transcript-style quoting is not allowed", number);
  }

  if (hasCommandBlock(body)) {
    fail(failures, "command-like copied content is not allowed", number);
  }

  const meta = extractMeta(trimmed);
  for (const field of REQUIRED_FIELDS) {
    if (!meta.some((item) => item.key === field && item.value.length > 0)) {
      fail(failures, `missing required metadata field [${field}: ...]`, number);
    }
  }

  for (const item of meta) {
    if ((item.key === "last-confirmed" || item.key === "last-worked") && !DATE_RE.test(item.value)) {
      fail(failures, `${item.key} must use YYYYMMDD`, number);
    }

    if (item.key === "notes") {
      if (item.value.startsWith("http://") || item.value.startsWith("https://")) {
        fail(failures, "notes metadata must point to a repo path, not a URL", number);
      }
    }

    if (item.key === "path" && !item.value.startsWith("/")) {
      fail(failures, "path metadata must be an absolute path", number);
    }
  }

  const urls = Array.from(trimmed.matchAll(/https?:\/\/\S+/g)).map((match) => match[0].replace(/[),.;]+$/, ""));
  for (const url of urls) {
    if (!STABLE_URL_RE.test(url)) {
      fail(failures, "malformed URL detected", number);
      continue;
    }
    if (!/(github|gitlab|docs?|localhost|127\.0\.0\.1|opencode)/i.test(url)) {
      fail(failures, "URLs are allowed only for stable environment or project anchors", number);
    }
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Missing file path argument");
    process.exit(1);
  }

  const src = Bun.file(file);
  if (!(await src.exists())) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  if (src.size > MAX_BYTES) {
    console.error(`File exceeds max size: ${file}`);
    console.error(`Size: ${src.size} bytes`);
    console.error(`Limit: ${MAX_BYTES} bytes`);
    process.exit(1);
  }

  const text = await src.text();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const failures: Failure[] = [];

  validateTitle(lines, failures);
  for (const [index, line] of lines.entries()) {
    validateLine(line, index + 1, failures);
  }

  if (failures.length === 0) {
    process.exit(0);
  }

  for (const failure of failures) {
    if (failure.line) {
      console.error(`Line ${failure.line}: ${failure.message}`);
      continue;
    }
    console.error(failure.message);
  }
  process.exit(1);
}

if (import.meta.main) await main();
