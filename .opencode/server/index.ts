/**
 * # Cron Worker
 * 
 * This project can run OpenCode cron jobs against a shared headless backend.
 * 
 * ## Flow
 * 
 * - `./start.sh` starts `opencode serve` in a tmux session named `opencode-assistant-backend`
 * - `./start.sh` starts the cron worker in a tmux session named `opencode-assistant-cron`
 * - `./start.sh` then runs `opencode attach http://127.0.0.1:4096`
 * - `./stop.sh` stops both tmux sessions cleanly
 * 
 * The TUI stays attached to the shared backend. Cron-triggered sessions run in the background and can be opened from the session list while they are still running.
 * 
 * ## Config
 * 
 * Configure jobs in [.opencode/server.jsonc](/home/lohzi/Projects/opencode-assistant/.opencode/server.jsonc).
 * 
 * Supported fields:
 * 
 * - `timezone`: optional IANA timezone like `Asia/Kuala_Lumpur`
 * - `jobs`: array of job definitions
 * - `id`: stable unique id for the job
 * - `title`: title for the new session created on each run
 * - `cron`: 5-field cron expression (`minute hour day month weekday`)
 * - `prompt`: prompt text sent to the new background session
 * - `enabled`: optional boolean, defaults to `true`
 * - `no_overlap`: optional boolean, skip a run if the previous session for the same job is still busy
 * - `agent`: optional agent name
 * - `model`: optional `{ providerID, modelID }`
 * 
 * Each trigger creates a brand new root session.
 * 
 * ## tmux
 * 
 * Useful commands:
 * 
 * ```bash
 * tmux attach -t opencode-assistant-backend
 * tmux attach -t opencode-assistant-cron
 * tmux kill-session -t opencode-assistant-backend
 * tmux kill-session -t opencode-assistant-cron
 * ```
 * 
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Model = {
  providerID: string;
  modelID: string;
};

type Job = {
  id: string;
  title: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
  no_overlap?: boolean;
  agent?: string;
  model?: Model;
};

type Cfg = {
  timezone?: string;
  jobs?: Job[];
};

type State = {
  runs: Record<string, number>;
  active: Record<string, string>;
};

type Session = {
  id: string;
};

const root = path.resolve(import.meta.dir, "../..");
const file = path.resolve(root, ".opencode/server.jsonc");
const dir = path.resolve(root, ".opencode/server/state");
const stateFile = path.join(dir, "cron-state.json");
const host = process.env.OPENCODE_ASSISTANT_HOST ?? "127.0.0.1";
const port = process.env.OPENCODE_ASSISTANT_PORT ?? "4096";
const base = `http://${host}:${port}`;
const auth = process.env.OPENCODE_SERVER_PASSWORD
  ? `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
  : undefined;

const run = new Map<string, string>();

main().catch((err) => {
  console.error("cron worker failed", err);
  process.exit(1);
});

async function main() {
  await mkdir(dir, { recursive: true });
  await health();
  listen().catch((err) => {
    console.error("event stream stopped", err);
  });
  await tick();
  loop();
}

function next() {
  const now = Date.now();
  return 60_000 - (now % 60_000);
}

function loop() {
  setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      console.error("tick failed", err);
    }
    loop();
  }, next());
}

async function tick() {
  const cfg = parse(await readFile(file, "utf8"));
  const jobs = (cfg.jobs ?? []).filter((x) => x.enabled !== false);
  const state = await load();
  await sync(state);
  const now = new Date();

  for (const job of jobs) {
    if (!match(job.cron, now, cfg.timezone)) continue;
    const stamp = minute(now, cfg.timezone);
    if (state.runs[job.id] === stamp) continue;
    if (job.no_overlap && state.active[job.id]) {
      console.log(`[skip] ${job.id} is still running`);
      state.runs[job.id] = stamp;
      await save(state);
      continue;
    }
    state.runs[job.id] = stamp;
    await runJob(job, state, cfg.timezone);
  }
}

async function runJob(job: Job, state: State, tz?: string) {
  console.log(`[run] ${job.id}`);
  const session = await create(job.title);
  state.active[job.id] = session.id;
  run.set(session.id, job.id);
  await save(state);

  try {
    const trimmedPrompt = job.prompt.trim();
    const isSlashCommand = trimmedPrompt.startsWith("/");
    
    if (isSlashCommand) {
      await sendCommand(session.id, job, trimmedPrompt);
    } else {
      const prompt = `${job.prompt}\n\nTriggered at ${label(new Date(), tz)} by cron job \`${job.id}\`.`;
      await promptAsync(session.id, job, prompt);
    }
  } catch (err) {
    delete state.active[job.id];
    run.delete(session.id);
    await save(state);
    throw err;
  }
}

async function create(title: string) {
  return await req<Session>("/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

async function promptAsync(sessionID: string, job: Job, prompt: string) {
  await req(`/session/${sessionID}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({
      agent: job.agent,
      model: job.model,
      parts: [{ type: "text", text: prompt }],
    }),
    expect: 204,
  });
}

async function sendCommand(sessionID: string, job: Job, commandText: string) {
  const [head, ...tail] = commandText.split(" ");
  const commandName = head?.startsWith("/") ? head.slice(1) : commandText;
  const arguments_ = tail.join(" ");
  
  await req(`/session/${sessionID}/command`, {
    method: "POST",
    body: JSON.stringify({
      agent: job.agent,
      model: job.model,
      command: commandName,
      arguments: arguments_,
    }),
  });
}

async function health() {
  for (let i = 0; i < 30; i++) {
    try {
      await req("/global/health");
      return;
    } catch {
      await sleep(1_000);
    }
  }
  throw new Error(`opencode server not reachable at ${base}`);
}

async function listen() {
  while (true) {
    try {
      const res = await fetch(`${base}/global/event`, { headers: headers() });
      if (!res.ok || !res.body)
        throw new Error(`event stream failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const out = await reader.read();
        if (out.done) break;
        buf += decoder.decode(out.value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) handle(part);
      }
    } catch (err) {
      console.error("event stream reconnect", err);
      await sleep(2_000);
    }
  }
}

function handle(raw: string) {
  const lines = raw.split("\n");
  let type = "";
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }

  if (!type || data.length === 0) return;
  const evt = JSON.parse(data.join("\n")) as {
    sessionID?: string;
    status?: { type?: string };
  };

  if (type !== "session.status") return;
  if (!evt.sessionID) return;
  const job = run.get(evt.sessionID);
  if (!job) return;
  if (evt.status?.type === "busy") return;

  run.delete(evt.sessionID);
  release(job, evt.sessionID).catch((err) => {
    console.error("release failed", err);
  });
}

async function load(): Promise<State> {
  try {
    const text = await readFile(stateFile, "utf8");
    const data = JSON.parse(text);
    if (!record(data) || !record(data.runs) || !record(data.active)) {
      return { runs: {}, active: {} };
    }
    return {
      runs: Object.fromEntries(
        Object.entries(data.runs).filter(
          (x): x is [string, number] => typeof x[1] === "number",
        ),
      ),
      active: Object.fromEntries(
        Object.entries(data.active).filter(
          (x): x is [string, string] => typeof x[1] === "string",
        ),
      ),
    };
  } catch {
    return { runs: {}, active: {} };
  }
}

async function save(state: State) {
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
}

async function sync(state: State) {
  const status =
    await req<Record<string, { type?: string }>>("/session/status");
  let dirty = false;

  for (const [job, sessionID] of Object.entries(state.active)) {
    run.set(sessionID, job);
    if (status[sessionID]?.type === "busy") continue;
    delete state.active[job];
    run.delete(sessionID);
    dirty = true;
  }

  if (dirty) await save(state);
}

async function release(job: string, sessionID: string) {
  const state = await load();
  if (state.active[job] !== sessionID) return;
  delete state.active[job];
  await save(state);
}

function headers() {
  return {
    "content-type": "application/json",
    ...(auth ? { authorization: auth } : {}),
  };
}

async function req<T = unknown>(
  url: string,
  init: RequestInit & { expect?: number } = {},
) {
  const res = await fetch(`${base}${url}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok && res.status !== init.expect) {
    throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  }
  if (init.expect === 204 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function parse(text: string): Cfg {
  const data = JSON.parse(clean(text));
  if (!record(data)) throw new Error("server.jsonc must be an object");
  const jobs = Array.isArray(data.jobs) ? data.jobs.filter(valid) : [];
  return {
    timezone: typeof data.timezone === "string" ? data.timezone : undefined,
    jobs,
  };
}

function valid(x: unknown): x is Job {
  if (!record(x)) return false;
  if (typeof x.id !== "string") return false;
  if (typeof x.title !== "string") return false;
  if (typeof x.cron !== "string") return false;
  if (typeof x.prompt !== "string") return false;
  if (x.enabled !== undefined && typeof x.enabled !== "boolean") return false;
  if (x.no_overlap !== undefined && typeof x.no_overlap !== "boolean")
    return false;
  if (x.agent !== undefined && typeof x.agent !== "string") return false;
  if (x.model !== undefined) {
    if (!record(x.model)) return false;
    if (typeof x.model.providerID !== "string") return false;
    if (typeof x.model.modelID !== "string") return false;
  }
  return true;
}

function clean(text: string) {
  let out = "";
  let str = false;
  let esc = false;
  let line = false;
  let block = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (line) {
      if (ch === "\n") {
        line = false;
        out += ch;
      }
      continue;
    }

    if (block) {
      if (ch === "*" && next === "/") {
        block = false;
        i++;
      }
      continue;
    }

    if (str) {
      out += ch;
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') str = false;
      continue;
    }

    if (ch === '"') {
      str = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      line = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      block = true;
      i++;
      continue;
    }

    out += ch;
  }

  return commas(out);
}

function commas(text: string) {
  let out = "";
  let str = false;
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (str) {
      out += ch;
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') str = false;
      continue;
    }

    if (ch === '"') {
      str = true;
      out += ch;
      continue;
    }

    if (ch !== ",") {
      out += ch;
      continue;
    }

    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === "]" || text[j] === "}") continue;
    out += ch;
  }

  return out;
}

function match(expr: string, now: Date, tz?: string) {
  const part = expr.trim().split(/\s+/);
  if (part.length !== 5) throw new Error(`invalid cron: ${expr}`);
  const date = zoned(now, tz);
  const vals = [date.minute, date.hour, date.day, date.month, date.weekday];
  return part.every((x, i) => field(x, vals[i], i));
}

function field(expr: string, val: number, idx: number) {
  return expr.split(",").some((x) => piece(x, val, idx));
}

function piece(expr: string, val: number, idx: number) {
  const [base, rawStep] = expr.split("/");
  const step = rawStep ? Number(rawStep) : 1;
  if (!Number.isInteger(step) || step < 1) return false;
  const [min] = range(idx);

  if (base === "*") return (val - min) % step === 0;

  if (base.includes("-")) {
    const [a, b] = base.split("-").map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (val < a || val > b) return false;
    return (val - a) % step === 0;
  }

  const num = Number(base);
  if (!Number.isInteger(num)) return false;
  return val === num;
}

function range(idx: number) {
  if (idx === 0) return [0, 59];
  if (idx === 1) return [0, 23];
  if (idx === 2) return [1, 31];
  if (idx === 3) return [1, 12];
  return [0, 6];
}

function zoned(now: Date, tz?: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hour12: false,
  });

  const map = Object.fromEntries(
    fmt.formatToParts(now).map((x) => [x.type, x.value]),
  );
  const day =
    map.weekday === "Sun"
      ? 0
      : map.weekday === "Mon"
        ? 1
        : map.weekday === "Tue"
          ? 2
          : map.weekday === "Wed"
            ? 3
            : map.weekday === "Thu"
              ? 4
              : map.weekday === "Fri"
                ? 5
                : 6;

  return {
    minute: Number(map.minute),
    hour: Number(map.hour),
    day: Number(map.day),
    month: Number(map.month),
    weekday: day,
  };
}

function minute(now: Date, tz?: string) {
  const date = zoned(now, tz);
  return Number(
    `${now.getUTCFullYear()}${pad(date.month)}${pad(date.day)}${pad(date.hour)}${pad(date.minute)}`,
  );
}

function label(now: Date, tz?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function record(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
