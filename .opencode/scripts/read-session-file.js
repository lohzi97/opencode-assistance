/**
 * Read Session File Script
 *
 * Purpose:
 * - Read a session markdown file composed of assistance "actions" (User/Assistant turns)
 * - Group lines into action blocks, apply a small "session compaction" mapping to
 *   collapse repeated filler turns, paginate the resulting blocks by a line limit,
 *   and print a requested page to stdout.
 *
 * Usage:
 *   node .opencode/scripts/read-session-file.js <file_path> --lines <number> --page <index> [--frontmatter]
 *
 * Arguments:
 * - file_path (required): path to the session file to read (absolute or relative)
 * - --lines <number> (required, >0): maximum number of "lines" per page. The script
 *   preserves exact newlines and counts array entries produced by the split as lines.
 * - --page <index> (required, >=0): zero-based page index to output.
 * - --frontmatter (optional): prepend YAML front matter with pagination metadata
 *   before printing the requested page content.
 *
 * Behavior:
 * - Reads the file as UTF-8 and preserves exact newline characters using
 *   `content.match(/[^
 * - Groups lines into actions. A new action begins when a '---' divider is
 *   encountered and the next non-empty line is a header starting with
 *   '## User' or '## Assistant'. The '---' divider is included in the action.
 * - Detects empty user actions (an action that only contains '## User' after
 *   removing dividers and whitespace). When an Assistant action is wrapped by
 *   two empty User actions (pattern: empty user, assistant, empty user) the
 *   three blocks are replaced with a single placeholder block containing
 *   '## SESSION COMPACTION\n\n'. This keeps pagination compact and meaningful.
 * - Paginates processed actions by accumulating blocks until adding the next
 *   block would exceed the --lines limit. If a single action alone exceeds the
 *   limit it is placed alone on its own page so callers still receive content.
 * - Writes the requested page's actions to stdout. Actions are concatenated
 *   preserving original newlines (useful for downstream tools expecting exact
 *   formatting).
 * - When --frontmatter is provided, writes a YAML front matter block first with
 *   `page`, `last_page`, `total_pages`, and `has_page`, followed by the page
 *   content. Default output remains content-only for backward compatibility.
 *
 * Examples:
 *   node .opencode/scripts/read-session-file.js journals/session/20260402-xxx.md --lines 200 --page 0
 *   node .opencode/scripts/read-session-file.js journals/session/20260402-xxx.md --lines 200 --page 0 --frontmatter
 *
 * Exit codes:
 * - 0: success (page printed or nothing printed if page index out of range)
 * - 1: usage error (missing/invalid arguments)
 *
 * Notes and caveats:
 * - The script counts "lines" as the number of entries returned by the regex
 *   split; a very long physical line still counts as a single line.
 * - Page index is zero-based.
 * - Intended for deterministic extraction/pagination of exported session files
 *   used by CI, local debugging tools, or other automation.
 */

const fs = require('fs');

function main() {
    const args = process.argv.slice(2);
    let filePath = '';
    let linesLimit = 0;
    let pageIndex = 0;
    let useFrontmatter = false;

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--lines' && i + 1 < args.length) {
            linesLimit = parseInt(args[++i], 10);
        } else if (args[i] === '--page' && i + 1 < args.length) {
            pageIndex = parseInt(args[++i], 10);
        } else if (args[i] === '--frontmatter') {
            useFrontmatter = true;
        } else if (!args[i].startsWith('--')) {
            filePath = args[i];
        }
    }

    if (!filePath || linesLimit <= 0 || pageIndex < 0) {
        console.error("Usage: node the-script.js <file> --lines <number> --page <index>");
        process.exit(1);
    }

    // Read file and retain exact newlines
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.match(/[^\n]*\n|[^\n]+/g) || [];

    const actions = [];
    let currentAction = [];

    // 1. Group lines into distinct "assistance actions / turns"
    for (let i = 0; i < lines.length; i++) {
        let isNewAction = false;
        
        // A new action chunk begins if a line is '---' and the next non-empty line is a User/Assistant header
        if (lines[i].trim() === '---') {
            for (let j = i + 1; j < lines.length; j++) {
                const trimmed = lines[j].trim();
                if (trimmed === '') continue;
                if (trimmed.startsWith('## User') || trimmed.startsWith('## Assistant')) {
                    isNewAction = true;
                }
                break;
            }
        }

        if (isNewAction) {
            if (currentAction.length > 0) {
                actions.push(currentAction);
            }
            currentAction = [lines[i]]; // Start fresh with the '---' divider
        } else {
            currentAction.push(lines[i]);
        }
    }

    if (currentAction.length > 0) {
        actions.push(currentAction);
    }

    // Helper: detects an empty user input (only contains "## User" when ignoring dividers and whitespace)
    function isEmptyUser(actionLines) {
        const cleaned = actionLines.map(l => l.trim()).filter(l => l !== '' && l !== '---');
        return cleaned.length === 1 && cleaned[0] === '## User';
    }

    // 2. Apply Session Compaction mapping
    const processedActions = [];
    let i = 0;
    while (i < actions.length) {
        if (i + 2 < actions.length) {
            // If wrapped by 2 empty user inputs
            if (isEmptyUser(actions[i]) && isEmptyUser(actions[i + 2])) {
                const middleCleaned = actions[i + 1].map(l => l.trim()).filter(l => l !== '' && l !== '---');
                
                // Confirm the middle is an Assistant action
                if (middleCleaned.length > 0 && middleCleaned[0].startsWith('## Assistant')) {
                    processedActions.push(["## SESSION COMPACTION\n\n"]);
                    i += 3; // Skip all three blocks
                    continue;
                }
            }
        }
        processedActions.push(actions[i]);
        i++;
    }

    // 3. Paginate the processed blocks
    const pages = [];
    let currentPage = [];
    let currentPageLines = 0;

    for (const action of processedActions) {
        const actionLen = action.length; // 1 line = 1 array item

        // If adding this block breaks the line limit threshold
        if (currentPageLines + actionLen > linesLimit) {
            if (currentPageLines === 0) {
                // Exceptional case: If the very first block *alone* exceeds the limit, 
                // it must be appended alone so that at least one action is returned.
                currentPage.push(action);
                pages.push(currentPage);
                currentPage = [];
                currentPageLines = 0;
            } else {
                // Otherwise, wrap up the current page and bump this block to the next page
                pages.push(currentPage);
                currentPage = [action];
                currentPageLines = actionLen;
            }
        } else {
            // Fits within the threshold
            currentPage.push(action);
            currentPageLines += actionLen;
        }
    }

    if (currentPage.length > 0) {
        pages.push(currentPage);
    }

    const totalPages = pages.length;
    const lastPage = totalPages > 0 ? totalPages - 1 : -1;
    const hasPage = pageIndex < totalPages;
    const pageContent = hasPage
        ? pages[pageIndex].map((action) => action.join('')).join('')
        : '';

    // 4. Output the requested page
    if (useFrontmatter) {
        process.stdout.write('---\n');
        process.stdout.write(`page: ${pageIndex}\n`);
        process.stdout.write(`last_page: ${lastPage}\n`);
        process.stdout.write(`total_pages: ${totalPages}\n`);
        process.stdout.write(`has_page: ${hasPage}\n`);
        process.stdout.write('---\n');
    }

    process.stdout.write(pageContent);
}

main();
