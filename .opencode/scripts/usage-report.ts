#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";

const GROUPS = ["by-session", "by-provider", "by-model", "by-day"] as const;
const FORMATS = ["table", "csv", "json"] as const;
const SORTS = ["tokens", "cost", "name"] as const;

type Group = (typeof GROUPS)[number];
type Format = (typeof FORMATS)[number];
type Sort = (typeof SORTS)[number];

type Args = {
  db: string;
  session?: string;
  project?: string;
  days?: number;
  from?: string;
  to?: string;
  group: Group;
  format: Format;
  sort: Sort;
  timezone?: string;
  help: boolean;
};

type Window = {
  fromMs: number | null;
  toMs: number | null;
  fromISO: string | null;
  toISO: string | null;
  label: string;
};

type UsageRow = {
  key: string;
  sortName: string;
  provider: string;
  model: string;
  sessionId: string;
  title: string;
  models: string;
  day: string;
  msgs: number;
  cacheHit: number;
  cacheMiss: number;
  output: number;
  reasoning: number;
  cacheWrite: number;
  cost: number;
  total: number;
  hitRate: number | null;
};

type Summary = {
  sessions: number;
  messages: number;
  cacheHit: number;
  cacheMiss: number;
  output: number;
  reasoning: number;
  cacheWrite: number;
  cost: number;
  total: number;
  hitRate: number | null;
};

type Meta = {
  db: string;
  generatedAt: string;
  window: { from: string | null; to: string | null; label?: string };
  project: string | null;
  session: string | null;
  sessionInfo?: {
    title: string;
    agent: string;
    project: string;
    model: string;
    created: string;
  };
  group: string;
  sort: Sort;
  timezone?: string;
  skippedMessages: number;
};

type Report = { meta: Meta; rows: UsageRow[]; summary: Summary };

export class CliError extends Error {}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    db: defaultDbPath(),
    group: "by-provider",
    format: "table",
    sort: "tokens",
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--db":
        args.db = requireValue(arg, argv[++i]);
        break;
      case "--session":
        args.session = requireValue(arg, argv[++i]);
        break;
      case "--project":
        args.project = requireValue(arg, argv[++i]);
        break;
      case "--days": {
        const raw = requireValue(arg, argv[++i]);
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) {
          throw new CliError(`--days must be an integer >= 1, got: ${raw}`);
        }
        args.days = n;
        break;
      }
      case "--from":
        args.from = requireValue(arg, argv[++i]);
        break;
      case "--to":
        args.to = requireValue(arg, argv[++i]);
        break;
      case "--group": {
        const value = requireValue(arg, argv[++i]);
        if (!GROUPS.includes(value as Group)) {
          throw new CliError(`Invalid --group: ${value} (expected ${GROUPS.join(" | ")})`);
        }
        args.group = value as Group;
        break;
      }
      case "--format": {
        const value = requireValue(arg, argv[++i]);
        if (!FORMATS.includes(value as Format)) {
          throw new CliError(`Invalid --format: ${value} (expected ${FORMATS.join(" | ")})`);
        }
        args.format = value as Format;
        break;
      }
      case "--json":
        args.format = "json";
        break;
      case "--sort": {
        const value = requireValue(arg, argv[++i]);
        if (!SORTS.includes(value as Sort)) {
          throw new CliError(`Invalid --sort: ${value} (expected ${SORTS.join(" | ")})`);
        }
        args.sort = value as Sort;
        break;
      }
      case "--timezone":
        args.timezone = requireValue(arg, argv[++i]);
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new CliError(`Unknown argument: ${arg}`);
    }
  }

  if (args.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: args.timezone });
    } catch {
      throw new CliError(`Invalid --timezone: ${args.timezone}`);
    }
  }
  if (args.from) validateDateArg(args.from);
  if (args.to) validateDateArg(args.to);

  return args;
}

function requireValue(flag: string, value?: string) {
  if (!value) throw new CliError(`Missing value for ${flag}`);
  return value;
}

export function validateDateArg(s: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new CliError(`Invalid date (expected YYYY-MM-DD): ${s}`);
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new CliError(`Invalid date (expected YYYY-MM-DD): ${s}`);
  }
}

function defaultDbPath(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, "opencode", "opencode.db");
  return path.join(homedir(), ".local", "share", "opencode", "opencode.db");
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

function printHelp() {
  console.log(`Usage: bun .opencode/scripts/usage-report.ts [options]

Report token consumption from an OpenCode SQLite database (read-only).

Options:
  --db <path>          Path to opencode.db (default: ~/.local/share/opencode/opencode.db)
  --session <id>       Report a single session (e.g. ses_...)
  --project <dir>      Filter by project directory (exact match on session.directory)
  --days <n>           Window: last N days, including today (e.g. --days 1 = today)
  --from <YYYY-MM-DD>  Explicit start date (local time, inclusive)
  --to <YYYY-MM-DD>    Explicit end date (local time, inclusive)
  --group <key>        Aggregation: by-session | by-provider | by-model | by-day
                       (default: by-provider)
  --format <fmt>       Output: table | csv | json (default: table)
  --json               Shorthand for --format json
  --sort <col>         Sort key: tokens | cost | name (default: tokens desc)
  --timezone <tz>      IANA timezone for day boundaries (default: system local)
  -h, --help           Show help

Examples:
  bun .opencode/scripts/usage-report.ts --session ses_abc123
  bun .opencode/scripts/usage-report.ts --project /path/to/project --days 1
  bun .opencode/scripts/usage-report.ts --group by-model --format csv --days 7`);
}

function openDb(dbPath: string): Database {
  const resolved = expandHome(dbPath);
  if (!existsSync(resolved)) {
    throw new CliError(`Database not found: ${resolved}`);
  }
  const db = new Database(resolved, { readonly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

// --- Time helpers -----------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toISO(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`,
  ].join("");
}

function localMidnightMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function parseDateArg(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTimeLocal(ms: number, tz?: string): string {
  const d = new Date(ms);
  const base = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const abbrev =
    new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${base} ${abbrev}`;
}

function ymdOfMs(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function hmOfMs(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}

function zonedStartOfDayMs(ms: number, tz: string): number {
  const target = ymdOfMs(ms, tz);
  const [y, m, d] = target.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  for (let t = utcMidnight - 12 * 3600_000; t <= utcMidnight + 14 * 3600_000; t += 60_000) {
    if (ymdOfMs(t, tz) === target && hmOfMs(t, tz) === "00:00") return t;
  }
  return utcMidnight;
}

function daysAgoStartMs(n: number, tz?: string): number {
  const now = new Date();
  if (tz) {
    const [y, m, d] = ymdOfMs(now.getTime(), tz).split("-").map(Number);
    const targetUtc = Date.UTC(y, m - 1, d - (n - 1));
    return zonedStartOfDayMs(targetUtc, tz);
  }
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  return d.getTime();
}

function dayWindowMs(date: Date, tz?: string): number {
  if (tz) return zonedStartOfDayMs(date.getTime(), tz);
  return localMidnightMs(date);
}

function computeWindow(args: Args, db: Database): Window {
  const now = new Date();
  const nowMs = now.getTime();

  if (args.days !== undefined) {
    const fromMs = daysAgoStartMs(args.days, args.timezone);
    const label =
      args.days === 1
        ? `today (${formatDateMs(nowMs)})`
        : `last ${args.days} days (${formatDateMs(fromMs)} to ${formatDateMs(nowMs)})`;
    return {
      fromMs,
      toMs: nowMs,
      fromISO: toISO(new Date(fromMs)),
      toISO: toISO(now),
      label,
    };
  }

  let fromMs: number | null = null;
  let toMs: number | null = null;

  if (args.from) {
    fromMs = dayWindowMs(parseDateArg(args.from), args.timezone);
  }
  if (args.to) {
    const toDate = parseDate(args.to);
    toMs = dayWindowMs(toDate, args.timezone) + 24 * 3600_000;
  }

  if (fromMs === null && toMs === null) {
    const earliest = db.prepare("SELECT min(time_created) AS min FROM session").get() as { min: number | null };
    fromMs = earliest.min ?? 0;
    toMs = nowMs;
    return {
      fromMs,
      toMs,
      fromISO: toISO(new Date(fromMs)),
      toISO: toISO(now),
      label: "all time",
    };
  }

  if (fromMs === null) {
    const earliest = db.prepare("SELECT min(time_created) AS min FROM session").get() as { min: number | null };
    fromMs = earliest.min ?? 0;
  }
  if (toMs === null) toMs = nowMs;

  const label = [args.from && `from ${args.from}`, args.to && `to ${args.to}`].filter(Boolean).join(" ");
  const displayLabel = label || "all time";

  return {
    fromMs,
    toMs,
    fromISO: toISO(new Date(fromMs)),
    toISO: toISO(new Date(toMs)),
    label: displayLabel,
  };
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// --- Query layer -------------------------------------------------------------

const BASE_AGGREGATES = `
  count(*) AS msgs,
  coalesce(sum(coalesce(json_extract(m.data, '$.tokens.cache.read'), 0)), 0) AS cache_hit,
  coalesce(sum(coalesce(json_extract(m.data, '$.tokens.input'), 0)), 0) AS cache_miss,
  coalesce(sum(coalesce(json_extract(m.data, '$.tokens.output'), 0)), 0) AS output,
  coalesce(sum(coalesce(json_extract(m.data, '$.tokens.reasoning'), 0)), 0) AS reasoning,
  coalesce(sum(coalesce(json_extract(m.data, '$.tokens.cache.write'), 0)), 0) AS cache_write,
  coalesce(sum(coalesce(json_extract(m.data, '$.cost'), 0)), 0) AS cost`;

function buildWhere(args: Args, win: Window): { where: string; params: Record<string, unknown> } {
  const clauses = ["json_extract(m.data, '$.role') = 'assistant'"];
  const params: Record<string, unknown> = {};

  if (args.session) {
    clauses.push("m.session_id = $session");
    params["$session"] = args.session;
  }
  if (args.project) {
    clauses.push("s.directory = $project");
    params["$project"] = path.resolve(expandHome(args.project));
  }
  if (win.fromMs !== null) {
    clauses.push("m.time_created >= $from");
    params["$from"] = win.fromMs;
  }
  if (win.toMs !== null) {
    clauses.push("m.time_created < $to");
    params["$to"] = win.toMs;
  }

  return { where: clauses.join(" AND "), params };
}

export function toUsageRow(group: Group, r: Record<string, unknown>): UsageRow {
  const provider = str(r.provider_id);
  const model = str(r.model_id);
  const sessionId = str(r.session_id);
  const title = str(r.title);
  const models = str(r.models);
  const day = str(r.day);

  const cacheHit = num(r.cache_hit);
  const cacheMiss = num(r.cache_miss);
  const output = num(r.output);
  const reasoning = num(r.reasoning);
  const cacheWrite = num(r.cache_write);
  const cost = num(r.cost);
  const msgs = num(r.msgs);

  const key =
    group === "by-provider"
      ? provider
      : group === "by-model"
        ? `${provider}/${model}`
        : group === "by-session"
          ? sessionId
          : day;
  const total = cacheHit + cacheMiss + output + reasoning + cacheWrite;

  return {
    key,
    sortName: group === "by-session" ? title || sessionId : key,
    provider,
    model,
    sessionId,
    title,
    models,
    day,
    msgs,
    cacheHit,
    cacheMiss,
    output,
    reasoning,
    cacheWrite,
    cost,
    total,
    hitRate: hitRate(cacheHit, cacheMiss),
  };
}

function runGroupQuery(db: Database, args: Args, win: Window): UsageRow[] {
  const { where, params } = buildWhere(args, win);

  let select = "";
  let groupBy = "";
  switch (args.group) {
    case "by-provider":
      select = `
        coalesce(json_extract(m.data, '$.providerID'), '') AS provider_id,
        NULL AS model_id, NULL AS session_id, NULL AS title, NULL AS models, NULL AS day,${BASE_AGGREGATES}`;
      groupBy = "json_extract(m.data, '$.providerID')";
      break;
    case "by-model":
      select = `
        coalesce(json_extract(m.data, '$.providerID'), '') AS provider_id,
        coalesce(json_extract(m.data, '$.modelID'), '') AS model_id,
        NULL AS session_id, NULL AS title, NULL AS models, NULL AS day,${BASE_AGGREGATES}`;
      groupBy = "json_extract(m.data, '$.providerID'), json_extract(m.data, '$.modelID')";
      break;
    case "by-session":
      select = `
        NULL AS provider_id, NULL AS model_id,
        m.session_id AS session_id, s.title AS title,
        group_concat(DISTINCT coalesce(json_extract(m.data, '$.providerID'), '') || '/' || coalesce(json_extract(m.data, '$.modelID'), '')) AS models,
        NULL AS day,${BASE_AGGREGATES}`;
      groupBy = "m.session_id";
      break;
    case "by-day":
      select = `
        NULL AS provider_id, NULL AS model_id, NULL AS session_id, NULL AS title, NULL AS models,
        date(m.time_created / 1000, 'unixepoch', 'localtime') AS day,${BASE_AGGREGATES}`;
      groupBy = "day";
      break;
  }

  const sql = `
    SELECT ${select}
    FROM message m
    JOIN session s ON s.id = m.session_id
    WHERE ${where}
    GROUP BY ${groupBy}`;

  const stmt = db.prepare(sql);
  const raw = stmt.all(params) as Record<string, unknown>[];
  return raw.map((r) => toUsageRow(args.group, r));
}

function runGroupQueryZonedDay(db: Database, args: Args, win: Window): UsageRow[] {
  const { where, params } = buildWhere(args, win);
  const sql = `
    SELECT
      m.time_created AS t,
      coalesce(json_extract(m.data, '$.tokens.cache.read'), 0) AS cache_hit,
      coalesce(json_extract(m.data, '$.tokens.input'), 0) AS cache_miss,
      coalesce(json_extract(m.data, '$.tokens.output'), 0) AS output,
      coalesce(json_extract(m.data, '$.tokens.reasoning'), 0) AS reasoning,
      coalesce(json_extract(m.data, '$.tokens.cache.write'), 0) AS cache_write,
      coalesce(json_extract(m.data, '$.cost'), 0) AS cost
    FROM message m
    JOIN session s ON s.id = m.session_id
    WHERE ${where}`;
  const rows = db.prepare(sql).all(params) as Array<{
    t: number;
    cache_hit: number;
    cache_miss: number;
    output: number;
    reasoning: number;
    cache_write: number;
    cost: number;
  }>;

  const byDay = new Map<string, Record<string, unknown>>();
  const tz = args.timezone!;
  for (const r of rows) {
    const day = ymdOfMs(r.t, tz);
    let agg = byDay.get(day);
    if (!agg) {
      agg = {
        day,
        msgs: 0,
        cache_hit: 0,
        cache_miss: 0,
        output: 0,
        reasoning: 0,
        cache_write: 0,
        cost: 0,
      };
      byDay.set(day, agg);
    }
    agg.msgs = num(agg.msgs) + 1;
    agg.cache_hit = num(agg.cache_hit) + r.cache_hit;
    agg.cache_miss = num(agg.cache_miss) + r.cache_miss;
    agg.output = num(agg.output) + r.output;
    agg.reasoning = num(agg.reasoning) + r.reasoning;
    agg.cache_write = num(agg.cache_write) + r.cache_write;
    agg.cost = num(agg.cost) + r.cost;
  }
  return [...byDay.values()].map((r) => toUsageRow("by-day", r));
}

function countDistinctSessions(db: Database, args: Args, win: Window): number {
  const { where, params } = buildWhere(args, win);
  const sql = `
    SELECT count(DISTINCT m.session_id) AS n
    FROM message m
    JOIN session s ON s.id = m.session_id
    WHERE ${where}`;
  const row = db.prepare(sql).get(params) as { n: number };
  return num(row.n);
}

function countSkippedMessages(db: Database, args: Args, win: Window): number {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (args.session) {
    clauses.push("m.session_id = $session");
    params["$session"] = args.session;
  }
  if (args.project) {
    clauses.push("s.directory = $project");
    params["$project"] = path.resolve(expandHome(args.project));
  }
  if (win.fromMs !== null) {
    clauses.push("m.time_created >= $from");
    params["$from"] = win.fromMs;
  }
  if (win.toMs !== null) {
    clauses.push("m.time_created < $to");
    params["$to"] = win.toMs;
  }
  const base = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `
    SELECT count(*) AS n
    FROM message m
    JOIN session s ON s.id = m.session_id
    ${base} AND json_valid(m.data) = 0`;
  const row = db.prepare(sql).get(params) as { n: number };
  return num(row.n);
}

function runSingleSession(db: Database, args: Args): { rows: UsageRow[]; info: Record<string, unknown> } {
  const info = db
    .prepare(
      `SELECT id, title, directory, agent, model, time_created
       FROM session WHERE id = ?`,
    )
    .get(args.session!) as Record<string, unknown> | null;
  if (!info) {
    throw new CliError(`Session not found: ${args.session}`);
  }

  const sessionArgs: Args = {
    ...args,
    group: "by-model",
    session: args.session,
    days: undefined,
    from: undefined,
    to: undefined,
  };
  const win: Window = { fromMs: null, toMs: null, fromISO: null, toISO: null, label: "session" };
  const rows = runGroupQuery(db, sessionArgs, win);
  return { rows, info };
}

function summarize(rows: UsageRow[], sessions: number): Summary {
  const summary: Summary = {
    sessions,
    messages: 0,
    cacheHit: 0,
    cacheMiss: 0,
    output: 0,
    reasoning: 0,
    cacheWrite: 0,
    cost: 0,
    total: 0,
    hitRate: null,
  };
  for (const r of rows) {
    summary.messages += r.msgs;
    summary.cacheHit += r.cacheHit;
    summary.cacheMiss += r.cacheMiss;
    summary.output += r.output;
    summary.reasoning += r.reasoning;
    summary.cacheWrite += r.cacheWrite;
    summary.cost += r.cost;
    summary.total += r.total;
  }
  summary.hitRate = hitRate(summary.cacheHit, summary.cacheMiss);
  return summary;
}

export function hitRate(hit: number, miss: number): number | null {
  const denom = hit + miss;
  if (denom <= 0) return null;
  return hit / denom;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function sortRows(rows: UsageRow[], sort: Sort) {
  rows.sort((a, b) => {
    if (sort === "cost") return b.cost - a.cost;
    if (sort === "name") return a.sortName.localeCompare(b.sortName);
    return b.total - a.total;
  });
}

function formatSessionModel(modelJson: unknown): string {
  const raw = str(modelJson);
  if (!raw) return "-";
  try {
    const parsed = JSON.parse(raw) as { id?: string; providerID?: string; variant?: string };
    const id = parsed.id ?? "-";
    const provider = parsed.providerID ? ` (${parsed.providerID})` : "";
    const variant = parsed.variant ? ` [variant: ${parsed.variant}]` : "";
    return `${id}${provider}${variant}`;
  } catch {
    return raw;
  }
}

// --- Renderers ---------------------------------------------------------------

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatHitRate(rate: number | null): string {
  if (rate === null) return "-";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}`;
}

type Column = {
  header: string;
  align: "left" | "right";
  value: (r: UsageRow) => string;
};

function groupedColumns(group: Group): Column[] {
  const numeric: Column[] = [
    { header: "Msgs", align: "right", value: (r) => formatNumber(r.msgs) },
    { header: "Cache hit", align: "right", value: (r) => formatNumber(r.cacheHit) },
    { header: "Cache miss", align: "right", value: (r) => formatNumber(r.cacheMiss) },
    { header: "Output", align: "right", value: (r) => formatNumber(r.output) },
    { header: "Reasoning", align: "right", value: (r) => formatNumber(r.reasoning) },
    { header: "Total", align: "right", value: (r) => formatNumber(r.total) },
  ];
  switch (group) {
    case "by-provider":
      return [{ header: "Provider", align: "left", value: (r) => r.provider || "-" }, ...numeric];
    case "by-model":
      return [
        {
          header: "Model",
          align: "left",
          value: (r) => (r.provider && r.model ? `${r.provider}/${r.model}` : r.provider || r.model || "-"),
        },
        ...numeric,
      ];
    case "by-session":
      return [
        { header: "Session", align: "left", value: (r) => r.sessionId || "-" },
        { header: "Title", align: "left", value: (r) => truncate(r.title, 38) },
        { header: "Models", align: "left", value: (r) => truncate(r.models, 44) },
        ...numeric,
      ];
    case "by-day":
      return [{ header: "Day", align: "left", value: (r) => r.day || "-" }, ...numeric];
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function renderTable(report: Report): string {
  const lines: string[] = [];
  const meta = report.meta;
  lines.push(`Window: ${meta.window.label}${meta.project ? ` | Project: ${meta.project}` : ""}`);
  lines.push("");

  const cols = groupedColumns(meta.group as Group);
  const header = cols.map((c) => c.header);
  const widths = cols.map((c, i) =>
    Math.max(c.header.length, ...report.rows.map((r) => c.value(r).length), 1),
  );

  const fmtRow = (cells: string[]) =>
    cells
      .map((cell, i) => (cols[i]!.align === "right" ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
      .join("  ");

  lines.push(fmtRow(header));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of report.rows) lines.push(fmtRow(cols.map((c) => c.value(r))));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));

  const s = report.summary;
  const totalRow = cols.map((c) => {
    switch (c.header) {
      case "Provider":
      case "Model":
      case "Session":
      case "Title":
      case "Models":
      case "Day":
        return "Total";
      case "Msgs":
        return formatNumber(s.messages);
      case "Cache hit":
        return formatNumber(s.cacheHit);
      case "Cache miss":
        return formatNumber(s.cacheMiss);
      case "Output":
        return formatNumber(s.output);
      case "Reasoning":
        return formatNumber(s.reasoning);
      case "Total":
        return formatNumber(s.total);
      default:
        return "";
    }
  });
  lines.push(fmtRow(totalRow));
  return lines.join("\n");
}

function renderSingleSession(report: Report): string {
  const meta = report.meta;
  const info = meta.sessionInfo!;
  const lines: string[] = [];
  lines.push(`Session: ${meta.session}`);
  lines.push(`Title:   ${info.title || "-"}`);
  lines.push(`Project: ${info.project || "-"}`);
  lines.push(`Agent:   ${info.agent || "-"}`);
  lines.push(`Model:   ${info.model || "-"}`);
  lines.push(`Created: ${info.created}`);
  lines.push("");

  const cols: Column[] = [
    {
      header: "Provider / Model",
      align: "left",
      value: (r) => (r.provider && r.model ? `${r.provider}/${r.model}` : r.model || r.provider || "-"),
    },
    { header: "Msgs", align: "right", value: (r) => formatNumber(r.msgs) },
    { header: "Cache hit", align: "right", value: (r) => formatNumber(r.cacheHit) },
    { header: "Cache miss", align: "right", value: (r) => formatNumber(r.cacheMiss) },
    { header: "Output", align: "right", value: (r) => formatNumber(r.output) },
    { header: "Reasoning", align: "right", value: (r) => formatNumber(r.reasoning) },
    { header: "Hit rate", align: "right", value: (r) => formatHitRate(r.hitRate) },
  ];
  const header = cols.map((c) => c.header);
  const widths = cols.map((c, i) =>
    Math.max(c.header.length, ...report.rows.map((r) => c.value(r).length), 1),
  );
  const fmtRow = (cells: string[]) =>
    cells
      .map((cell, i) => (cols[i]!.align === "right" ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
      .join("  ");

  lines.push(fmtRow(header));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of report.rows) lines.push(fmtRow(cols.map((c) => c.value(r))));
  lines.push("");

  const s = report.summary;
  lines.push("Totals:");
  lines.push(`  Input (cache hit)   ${formatNumber(s.cacheHit)}`);
  lines.push(`  Input (cache miss)  ${formatNumber(s.cacheMiss)}`);
  lines.push(`  Output              ${formatNumber(s.output)}`);
  lines.push(`  Reasoning           ${formatNumber(s.reasoning)}`);
  lines.push(`  Cache write         ${formatNumber(s.cacheWrite)}`);
  lines.push(`  Total               ${formatNumber(s.total)}`);
  lines.push(`  Cache hit rate      ${formatHitRate(s.hitRate)}`);
  lines.push(`  Cost                ${formatCost(s.cost)}`);
  return lines.join("\n");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function renderCsv(report: Report): string {
  const header = [
    "group",
    "provider",
    "model",
    "msgs",
    "cache_hit",
    "cache_miss",
    "output",
    "reasoning",
    "cache_write",
    "cost",
    "total",
    "hit_rate",
  ];
  const lines = [header.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        csvEscape(r.key),
        csvEscape(r.provider),
        csvEscape(r.model),
        r.msgs,
        r.cacheHit,
        r.cacheMiss,
        r.output,
        r.reasoning,
        r.cacheWrite,
        r.cost,
        r.total,
        r.hitRate === null ? "" : r.hitRate.toFixed(4),
      ].join(","),
    );
  }
  const s = report.summary;
  lines.push(
    [
      "TOTAL",
      "",
      "",
      s.messages,
      s.cacheHit,
      s.cacheMiss,
      s.output,
      s.reasoning,
      s.cacheWrite,
      s.cost,
      s.total,
      s.hitRate === null ? "" : s.hitRate.toFixed(4),
    ].join(","),
  );
  return lines.join("\n");
}

export function renderJson(report: Report): string {
  const group = report.meta.group === "session" ? "by-model" : (report.meta.group as Group);
  const rows = report.rows.map((r) => jsonRow(r, group));
  const json = {
    meta: {
      db: report.meta.db,
      generated_at: report.meta.generatedAt,
      window: report.meta.window,
      project: report.meta.project,
      session: report.meta.session,
      group: report.meta.group,
      sort: report.meta.sort,
      timezone: report.meta.timezone,
      skipped_messages: report.meta.skippedMessages,
      session_info: report.meta.sessionInfo,
    },
    rows,
    summary: jsonSummary(report.summary),
  };
  return JSON.stringify(json, null, 2);
}

function jsonSummary(s: Summary): Record<string, unknown> {
  return {
    sessions: s.sessions,
    messages: s.messages,
    cache_hit: s.cacheHit,
    cache_miss: s.cacheMiss,
    output: s.output,
    reasoning: s.reasoning,
    cache_write: s.cacheWrite,
    cost: s.cost,
    total: s.total,
    cache_hit_rate: s.hitRate,
    cache_hit_rate_display: formatHitRate(s.hitRate),
  };
}

function jsonRow(r: UsageRow, group: Group): Record<string, unknown> {
  const base: Record<string, unknown> = {
    provider: r.provider || null,
    model: r.model || null,
    messages: r.msgs,
    cache_hit: r.cacheHit,
    cache_miss: r.cacheMiss,
    output: r.output,
    reasoning: r.reasoning,
    cache_write: r.cacheWrite,
    cost: r.cost,
    total: r.total,
    hit_rate: r.hitRate,
    hit_rate_display: formatHitRate(r.hitRate),
  };
  if (group === "by-provider") base.group = r.provider;
  if (group === "by-model") base.group = r.model ? `${r.provider}/${r.model}` : r.provider;
  if (group === "by-session") {
    base.session = r.sessionId;
    base.title = r.title;
    base.models = r.models;
    base.group = r.sessionId;
  }
  if (group === "by-day") {
    base.day = r.day;
    base.group = r.day;
  }
  return base;
}

// --- Main --------------------------------------------------------------------

async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (args.help) {
    printHelp();
    return;
  }

  let db: Database;
  try {
    db = openDb(args.db);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  try {
    const now = new Date();
    const meta: Meta = {
      db: expandHome(args.db),
      generatedAt: toISO(now),
      window: { from: null, to: null },
      project: args.project ? path.resolve(expandHome(args.project)) : null,
      session: args.session ?? null,
      group: args.session ? "session" : args.group,
      sort: args.sort,
      skippedMessages: 0,
    };
    if (args.timezone) meta.timezone = args.timezone;

    let report: Report;

    if (args.session) {
      const { rows, info } = runSingleSession(db, args);
      sortRows(rows, "tokens");
      const summary = summarize(rows, rows.length);
      meta.window = { from: null, to: null, label: "session" };
      meta.sessionInfo = {
        title: str(info.title),
        agent: str(info.agent),
        project: str(info.directory),
        model: formatSessionModel(info.model),
        created: formatDateTimeLocal(num(info.time_created), args.timezone),
      };
      meta.skippedMessages = countSkippedMessages(db, args, {
        fromMs: null,
        toMs: null,
        fromISO: null,
        toISO: null,
        label: "session",
      });
      report = { meta, rows, summary };
    } else {
      const win = computeWindow(args, db);
      meta.window = { from: win.fromISO, to: win.toISO, label: win.label };
      meta.skippedMessages = countSkippedMessages(db, args, win);
      const rows =
        args.group === "by-day" && args.timezone
          ? runGroupQueryZonedDay(db, args, win)
          : runGroupQuery(db, args, win);
      sortRows(rows, args.sort);
      const summary = summarize(rows, countDistinctSessions(db, args, win));
      report = { meta, rows, summary };
    }

    let output = "";
    if (args.format === "json") {
      output = renderJson(report);
    } else if (args.format === "csv") {
      output = renderCsv(report);
    } else {
      output = args.session ? renderSingleSession(report) : renderTable(report);
    }
    console.log(output);

    if (meta.skippedMessages > 0 && args.format !== "json") {
      console.error(`Note: ${meta.skippedMessages} message(s) skipped (malformed JSON)`);
    }
  } finally {
    db.close();
  }
}

if (import.meta.main) await main();