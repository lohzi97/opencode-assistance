#!/usr/bin/env bun
// Returns the Monday (start) and Sunday (end) dates for the week containing a given date.
// Usage:
//   bun .opencode/scripts/week-range.ts 20260404
//   -> prints two lines:
//      start: 20260330
//      end:   20260405

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYYYYMMDD(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function parseYYYYMMDD(s: string): Date | null {
  if (!/^[0-9]{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1; // monthIndex
  const day = Number(s.slice(6, 8));
  const dt = new Date(y, m, day);
  // Basic validation: ensure components match (catches invalid dates like 20230230)
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== day) return null;
  return dt;
}

function weekRangeFor(date: Date): { start: Date; end: Date } {
  // JS: 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const dow = date.getDay();
  // days to subtract to reach Monday
  const daysSinceMonday = (dow + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function main(argv: string[]): void {
  const arg = argv[2];
  let date: Date;
  if (!arg) {
    date = new Date();
  } else {
    const parsed = parseYYYYMMDD(arg);
    if (!parsed) {
      console.error('Invalid date. Expected YYYYMMDD, e.g. 20260404');
      // Exit code 2 indicates incorrect usage
      process.exit(2);
    }
    date = parsed;
  }

  const { start, end } = weekRangeFor(date);
  console.log('start: ' + formatYYYYMMDD(start));
  console.log('end:   ' + formatYYYYMMDD(end));
}

if (import.meta.main) main(process.argv as string[]);
