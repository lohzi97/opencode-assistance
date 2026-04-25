import path from "node:path";
import process from "node:process";
import {
  OpenCodeClient,
  ModelRef,
  BusEventPayload,
  record,
  readText,
  stateDir,
  writeJsonFile,
  root,
} from "./shared";
import { loadWorkerConfig } from "./config";

type Job = {
  id: string;
  cron: string;
  enabled?: boolean;
  no_overlap?: boolean;
  title?: string;
  prompt?: string;
  exec?: string[];
  agent?: string;
  model?: ModelRef;
};

type ActiveRun =
  | {
      kind: "session";
      id: string;
    }
  | {
      kind: "exec";
      pid: number;
    };

type State = {
  runs: Record<string, number>;
  active: Record<string, ActiveRun>;
};

const stateFile = path.join(stateDir, "cron-state.json");

export class CronService {
  private readonly client: OpenCodeClient;
  private readonly run = new Map<string, string>();

  constructor(client: OpenCodeClient) {
    this.client = client;
  }

  async start() {
    await this.tick();
    this.loop();
  }

  async handleEvent(event: BusEventPayload) {
    if (event.type !== "session.status") return;
    const sessionID = asString(event.properties.sessionID);
    const status = readStatus(event.properties.status);
    if (!sessionID || !status) return;
    const jobID = this.run.get(sessionID);
    if (!jobID) return;
    if (status.type === "busy") return;
    this.run.delete(sessionID);
    try {
      await this.release(jobID, { kind: "session", id: sessionID });
    } catch (err) {
      console.error("cron release failed", err);
    }
  }

  private loop() {
    setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        console.error("cron tick failed", err);
      }
      this.loop();
    }, nextMinuteDelay());
  }

  private async tick() {
    const config = await this.loadConfig();
    const jobs = (config.jobs ?? []).filter((job) => job.enabled !== false);
    const state = await this.loadState();
    await this.sync(state, jobs);
    const now = new Date();

    for (const job of jobs) {
      if (!matchesCron(job.cron, now, config.timezone)) continue;
      const stamp = minuteStamp(now, config.timezone);
      if (state.runs[job.id] === stamp) continue;
      if (job.no_overlap && state.active[job.id]) {
        console.log(`[cron] skip ${job.id}: previous run still active`);
        state.runs[job.id] = stamp;
        await this.saveState(state);
        continue;
      }
      state.runs[job.id] = stamp;
      await this.saveState(state);
      await this.runJob(job, state, config.timezone);
    }
  }

  private async runJob(job: Job, state: State, timezone?: string) {
    console.log(`[cron] run ${job.id}`);
    if (job.exec) {
      await this.runExecJob(job, state, timezone);
      return;
    }
    await this.runSessionJob(job, state, timezone);
  }

  private async runSessionJob(job: Job, state: State, timezone?: string) {
    const title = typeof job.title === "string" ? job.title : "Untitled Cron Job";
    const promptText = typeof job.prompt === "string" ? job.prompt : "";
    if (!promptText.trim()) {
      throw new Error(`job ${job.id} is missing prompt`);
    }

    const session = await this.client.createSession(title);
    state.active[job.id] = { kind: "session", id: session.id };
    this.run.set(session.id, job.id);
    await this.saveState(state);

    try {
      const trimmed = promptText.trim();
      if (trimmed.startsWith("/")) {
        const [head, ...tail] = trimmed.split(/\s+/);
        await this.client.command(session.id, {
          agent: job.agent,
          model: job.model,
          command: head.slice(1),
          arguments: tail.join(" "),
        });
      } else {
        const prompt = `${promptText}\n\nTriggered at ${label(new Date(), timezone)} by cron job \`${job.id}\`.`;
        await this.client.promptAsync(session.id, {
          agent: job.agent,
          model: job.model,
          parts: [{ type: "text", text: prompt }],
        });
      }
    } catch (err) {
      delete state.active[job.id];
      this.run.delete(session.id);
      await this.saveState(state);
      throw err;
    }
  }

  private async runExecJob(job: Job, state: State, timezone?: string) {
    const [command, ...args] = job.exec ?? [];
    if (!command) {
      throw new Error(`job ${job.id} has empty exec command`);
    }

    const child = Bun.spawn({
      cmd: [command, ...args],
      cwd: root,
      env: {
        ...process.env,
        OPENCODE_CRON_JOB_ID: job.id,
        OPENCODE_CRON_TRIGGERED_AT: label(new Date(), timezone),
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    if (child.pid === undefined) {
      throw new Error(`job ${job.id} failed to start exec process`);
    }

    const pid = child.pid;
    state.active[job.id] = { kind: "exec", pid };
    await this.saveState(state);

    void child.exited
      .then(async (code: number) => {
        if (code !== 0) {
          console.error(`[cron] exec ${job.id} exited with code ${code}`);
        }
        await this.release(job.id, { kind: "exec", pid });
      })
      .catch(async (err: unknown) => {
        console.error(`[cron] exec ${job.id} failed`, err);
        await this.release(job.id, { kind: "exec", pid });
      });
  }

  private async loadConfig() {
    return (await loadWorkerConfig()).cron;
  }

  private async loadState(): Promise<State> {
    try {
      const text = await readText(stateFile);
      const data = JSON.parse(text);
      if (!record(data) || !record(data.runs) || !record(data.active)) {
        return emptyState();
      }
      return {
        runs: Object.fromEntries(
          Object.entries(data.runs).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        ),
        active: Object.fromEntries(
          Object.entries(data.active).flatMap((entry) => {
            const active = parseActiveRun(entry[1]);
            return active ? [[entry[0], active]] : [];
          }),
        ),
      };
    } catch {
      return emptyState();
    }
  }

  private async saveState(state: State) {
    await writeJsonFile(stateFile, state);
  }

  private async sync(state: State, jobs: Job[]) {
    const hasSessionJobs = jobs.some((job) => !job.exec);
    const statuses = hasSessionJobs ? await this.client.sessionStatus() : {};
    let dirty = false;

    for (const [jobID, active] of Object.entries(state.active)) {
      if (active.kind === "session") {
        this.run.set(active.id, jobID);
        if (statuses[active.id]?.type === "busy") continue;
        delete state.active[jobID];
        this.run.delete(active.id);
        dirty = true;
        continue;
      }

      if (isAlive(active.pid)) continue;
      delete state.active[jobID];
      dirty = true;
    }

    if (dirty) {
      await this.saveState(state);
    }
  }

  private async release(jobID: string, active: ActiveRun) {
    const state = await this.loadState();
    const current = state.active[jobID];
    if (!sameRun(current, active)) return;
    delete state.active[jobID];
    await this.saveState(state);
  }
}

function parseActiveRun(input: unknown): ActiveRun | undefined {
  if (typeof input === "string") {
    return { kind: "session", id: input };
  }
  if (!record(input) || typeof input.kind !== "string") return undefined;
  if (input.kind === "session" && typeof input.id === "string") {
    return { kind: "session", id: input.id };
  }
  if (input.kind === "exec" && typeof input.pid === "number") {
    return { kind: "exec", pid: input.pid };
  }
  return undefined;
}

function matchesCron(expr: string, now: Date, timezone?: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`invalid cron: ${expr}`);
  }
  const date = zoned(now, timezone);
  const values = [date.minute, date.hour, date.day, date.month, date.weekday];
  return parts.every((part, idx) => matchesField(part, values[idx], idx));
}

function matchesField(expr: string, value: number, idx: number) {
  return expr.split(",").some((part) => matchesPiece(part, value, idx));
}

function matchesPiece(expr: string, value: number, idx: number) {
  const [base, rawStep] = expr.split("/");
  const step = rawStep ? Number(rawStep) : 1;
  if (!Number.isInteger(step) || step < 1) return false;
  const [min] = cronRange(idx);

  if (base === "*") {
    return (value - min) % step === 0;
  }

  if (base.includes("-")) {
    const [from, to] = base.split("-").map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    if (value < from || value > to) return false;
    return (value - from) % step === 0;
  }

  const num = Number(base);
  if (!Number.isInteger(num)) return false;
  return value === num;
}

function cronRange(idx: number) {
  if (idx === 0) return [0, 59] as const;
  if (idx === 1) return [0, 23] as const;
  if (idx === 2) return [1, 31] as const;
  if (idx === 3) return [1, 12] as const;
  return [0, 6] as const;
}

function zoned(now: Date, timezone?: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday =
    parts.weekday === "Sun"
      ? 0
      : parts.weekday === "Mon"
        ? 1
        : parts.weekday === "Tue"
          ? 2
          : parts.weekday === "Wed"
            ? 3
            : parts.weekday === "Thu"
              ? 4
              : parts.weekday === "Fri"
                ? 5
                : 6;

  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday,
  };
}

function minuteStamp(now: Date, timezone?: string) {
  const date = zoned(now, timezone);
  return Number(
    `${now.getUTCFullYear()}${pad(date.month)}${pad(date.day)}${pad(date.hour)}${pad(date.minute)}`,
  );
}

function label(now: Date, timezone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function nextMinuteDelay() {
  const now = Date.now();
  return 60_000 - (now % 60_000);
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sameRun(a: ActiveRun | undefined, b: ActiveRun) {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "session") return a.id === b.id;
  return a.pid === b.pid;
}

function readStatus(input: unknown) {
  if (!record(input) || typeof input.type !== "string") return undefined;
  if (input.type === "busy") return { type: "busy" } as const;
  if (input.type === "idle") return { type: "idle" } as const;
  if (
    input.type === "retry" &&
    typeof input.attempt === "number" &&
    typeof input.message === "string" &&
    typeof input.next === "number"
  ) {
    return {
      type: "retry",
      attempt: input.attempt,
      message: input.message,
      next: input.next,
    } as const;
  }
  return undefined;
}

function asString(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function emptyState(): State {
  return {
    runs: {},
    active: {},
  };
}
