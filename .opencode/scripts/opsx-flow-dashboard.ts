#!/usr/bin/env bun

// opsx-flow-dashboard: local web UI server for opsx-flow workflows.
//
// This is the DASHBOARD entry, a fully independent process file.  It imports
// the shared library from opsx-flow.ts (the driver module, which doubles as
// the shared library) and never spawns the driver itself.
//
// Running this file directly launches the web UI:
//   bun .opencode/scripts/opsx-flow-dashboard.ts [--port <port>] [--project-dir <path>]

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BusySessionsError,
  DEFAULT_MODEL,
  PHASES,
  clearManualPause,
  client,
  displayedPhase,
  getSessionReport,
  hasFlag,
  isProcessAlive,
  knownProjectDirs,
  loadFlowConfig,
  loadState,
  pauseMarkerExists,
  positiveInt,
  readDaemonPid,
  rejectUnknownFlags,
  resolvePhase,
  resolveProjectDir,
  resumeFlow,
  statePath,
  stopFlow,
  stringValue,
  valueFlag,
  writePauseMarker,
} from "./opsx-flow.ts";
import type { LogEntry } from "./opsx-flow.ts";

// ---------------------------------------------------------------------------
// Local web UI
// ---------------------------------------------------------------------------

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (!body.trim()) return {};
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) throw new Error("request body must be a JSON object");
  return parsed;
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function resolveUiProject(defaultProjectDir: string, url: URL): string {
  const requested = url.searchParams.get("projectDir");
  if (!requested) return defaultProjectDir;
  const projectDir = path.resolve(requested);
  if (!existsSync(statePath(projectDir))) {
    throw new Error(`no opsx-flow state for ${projectDir}`);
  }
  return projectDir;
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function opencodeServerUrl(): string {
  const configured = process.env.OPENCODE_SERVER_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return `http://${process.env.OPENCODE_ASSISTANT_HOST ?? "127.0.0.1"}:${process.env.OPENCODE_ASSISTANT_PORT ?? "4096"}`;
}

async function apiState(projectDir: string): Promise<Record<string, unknown>> {
  const file = statePath(projectDir);
  if (!existsSync(file)) throw new Error(`no opsx-flow state for ${projectDir}`);
  const state = await loadState(file);
  const config = await loadFlowConfig(state.configPath).catch(() => undefined);
  const paused = pauseMarkerExists(projectDir);
  const phases = PHASES.map((base, index) => {
    const phase = config ? resolvePhase(config, base) : { ...base, ...DEFAULT_MODEL, cap: state.caps[base.capKey] };
    return {
      id: phase.id,
      skill: phase.skill,
      family: phase.family,
      cap: phase.cap,
      loopCounter: state.loopCounters[phase.id] ?? 0,
      current: index === state.currentPhaseIdx,
      complete: index < state.currentPhaseIdx || state.workflowStatus === "completed",
    };
  });
  return {
    ...state,
    proposal: state.proposalName,
    phase: displayedPhase(state.currentPhaseIdx, state.workflowStatus),
    phases,
    paused,
    workflowStatus: paused && state.workflowStatus !== "completed" && state.workflowStatus !== "error"
      ? (state.workflowStatus === "awaiting-question" ? "awaiting-question" : "paused")
      : state.workflowStatus,
    implementerSessions: state.implementerSessions.map(({ report: _report, ...session }) => session),
    daemonAlive: isProcessAlive(readDaemonPid(projectDir) ?? state.daemonPid),
    uiAlive: isProcessAlive(state.uiPid),
  };
}

async function apiLog(projectDir: string, since?: string): Promise<{ entries: LogEntry[]; text: string }> {
  const file = path.join(projectDir, "openspec", ".opsx-flow.log");
  let lines: string[] = [];
  if (existsSync(file)) lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (since) lines = lines.filter((line) => line.slice(0, 24) >= since);
  lines = lines.slice(-500);
  const entries: LogEntry[] = lines.map((line) => {
    const match = line.match(/^(\S+)\s{2}(\S+)(?::\s(.*))?$/);
    return match ? { ts: match[1]!, event: match[2]!, ...(match[3] ? { detail: match[3] } : {}) } : { ts: "", event: line };
  });
  return { entries, text: lines.join("\n") };
}

async function apiQuestions(projectDir: string): Promise<unknown[]> {
  const stateFile = statePath(projectDir);
  if (!existsSync(stateFile)) return [];
  const state = await loadState(stateFile);
  const sessionIds = new Set(state.implementerSessions.map((session) => session.sessionId));
  const requests = await client.pendingQuestions({ directory: projectDir });
  return requests
    .filter((request) => sessionIds.has(request.sessionID))
    .map((request) => ({
      ...request,
      phaseId: state.implementerSessions.find((session) => session.sessionId === request.sessionID)?.phaseId,
      openCommand: `opencode attach ${shellArg(opencodeServerUrl())} --dir ${shellArg(projectDir)} --session ${shellArg(request.sessionID)}`,
    }));
}

async function apiReport(projectDir: string, sessionId: string): Promise<{ sessionId: string; text: string }> {
  const state = await loadState(statePath(projectDir));
  if (!state.implementerSessions.some((session) => session.sessionId === sessionId)) {
    throw new Error("session is not part of this workflow");
  }
  const report = await getSessionReport(sessionId, projectDir);
  return { sessionId, text: report.text };
}

function uiHtml(projectDir: string, port: number): string {
  const projectJson = JSON.stringify(projectDir).replace(/</g, "\\u003c");
  const projectValue = htmlEscape(projectDir);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>opsx-flow</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #101318; color: #e8edf5; }
    body { margin: 0; padding: 24px; max-width: 1280px; margin-inline: auto; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    h2 { font-size: 16px; margin: 0 0 10px; }
    .muted { color: #9ba6b7; font-size: 13px; }
    .panel { border: 1px solid #2c3543; border-radius: 9px; padding: 16px; margin: 14px 0; background: #171c24; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, select, input { border: 1px solid #3d4a5d; border-radius: 5px; background: #202938; color: inherit; padding: 7px 9px; }
    button { cursor: pointer; } button:hover { border-color: #86aef8; }
    button#stop:hover { border-color: #e57171; }
    .status { display: inline-block; border-radius: 999px; padding: 4px 9px; font-size: 12px; background: #26364d; }
    .status.paused, .status.awaiting-question { background: #6a4b1f; }
    .status.completed { background: #245c42; }
    .timeline { display: flex; flex-direction: column; gap: 4px; }
    .phase { padding: 8px 10px; border: 1px solid #2c3543; border-radius: 6px; opacity: .72; }
    .phase.current { border-color: #80a9ff; opacity: 1; box-shadow: 0 0 0 1px #80a9ff44; }
    .phase.complete { border-color: #397354; opacity: 1; }
    .phase-name { font-weight: 600; font-size: 13px; } .phase-meta { margin-top: 2px; font-size: 12px; color: #9ba6b7; }
    .phase-steps { list-style: none; margin: 6px 0 0 0; padding: 0 0 0 18px; border-left: 1px solid #2c3543; }
    .step { font: 12px ui-monospace, monospace; padding: 2px 0 2px 6px; color: #c2cdd9; position: relative; }
    .step::before { content: '├─'; position: absolute; left: -16px; color: #4a5666; }
    .step:last-child::before { content: '└─'; }
    .step.running { color: #ffd58a; }
    .step.running::after { content: ' ●'; color: #80a9ff; }
    .step.error { color: #ff9e9e; }
    .step .summary { color: #9ba6b7; }
    .question { border-left: 3px solid #e0a544; padding: 10px 12px; margin: 8px 0; background: #20242d; }
    .question h3 { font-size: 14px; margin: 0 0 6px; } .question p { white-space: pre-wrap; }
    code, pre { font-family: ui-monospace, monospace; } pre { overflow: auto; white-space: pre-wrap; background: #0c0f13; padding: 12px; border-radius: 5px; max-height: 360px; }
    .error { color: #ff9e9e; } .success { color: #9ae6b4; }
    #events { max-height: 300px; overflow: auto; }
    .event { font: 12px ui-monospace, monospace; padding: 3px 0; border-bottom: 1px solid #232a35; }
  </style>
</head>
<body>
  <header>
    <h1>opsx-flow</h1>
    <div class="muted">Planner-free OpenSpec workflow · UI port ${port}</div>
  </header>
  <section class="panel">
    <div class="toolbar">
      <label for="project-picker">Project</label>
      <input id="project-picker" list="known-projects" size="60" value="${projectValue}">
      <datalist id="known-projects"></datalist>
      <span id="proposal" class="muted"></span>
      <span id="status" class="status">loading</span>
    </div>
    <div class="toolbar" style="margin-top:10px">
      <button id="pause">Pause</button><button id="continue">Continue</button><button id="stop">Stop</button>
      <label for="next-phase">Resume at</label>
      <select id="next-phase"><option value="">current phase</option></select>
      <button id="resume">Resume daemon</button>
      <span id="message" class="muted"></span>
    </div>
  </section>
  <section class="panel"><h2>Phase timeline</h2><div id="timeline" class="timeline"></div></section>
  <section class="panel"><h2>Pending questions</h2><div id="questions"><span class="muted">None</span></div></section>
  <section class="panel"><h2>Implementer report</h2><select id="session-select"><option value="">Select a session</option></select><pre id="report">Select a session to view its last assistant report.</pre></section>
  <section class="panel"><h2>Event stream</h2><div id="events"></div></section>
<script>
const attachedProject = ${projectJson};
const queryProject = new URLSearchParams(window.location.search).get('projectDir');
const selectedProject = queryProject || attachedProject;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (id) => document.getElementById(id);
let seenQuestions = new Set();
let seenLogEntries = new Set();
let lastLog = '';
function apiUrl(url) { const target = new URL(url, window.location.href); if (!target.searchParams.has('projectDir')) target.searchParams.set('projectDir', selectedProject); return target.pathname + target.search; }
async function getJson(url, options) { const response = await fetch(apiUrl(url), options); const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText); return data; }
function showMessage(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : 'success'; }
async function refreshState() {
  try {
    const state = await getJson('/api/state');
    $('proposal').textContent = state.proposal + ' · ' + state.branch + ' · daemon ' + (state.daemonAlive ? 'alive' : 'stopped');
    $('status').textContent = state.workflowStatus + (state.pauseReason ? ' · ' + state.pauseReason : '');
    $('status').className = 'status ' + state.workflowStatus;
    // Group steps by their parent phase so each phase card can show its
    // sub-step history (finder / issue-audit / fix runs) as an indented list.
    const stepsByPhase = {};
    for (const step of (state.steps || [])) {
      if (!stepsByPhase[step.phaseId]) stepsByPhase[step.phaseId] = [];
      stepsByPhase[step.phaseId].push(step);
    }
    $('timeline').innerHTML = (state.phases || []).map((phase) => {
      const marker = phase.complete ? '✓' : (phase.current ? '▶' : '□');
      const phaseSteps = stepsByPhase[phase.id] || [];
      const stepsHtml = phaseSteps.length ? '<ul class="phase-steps">' + phaseSteps.map((step) => {
        const cls = 'step ' + step.status;
        const summary = step.summary ? ' — <span class="summary">' + esc(step.summary) + '</span>' : '';
        return '<li class="' + cls + '">' + esc(step.skill) + ' run ' + step.runIdx + summary + '</li>';
      }).join('') + '</ul>' : '';
      return '<div class="phase ' + (phase.current ? 'current ' : '') + (phase.complete ? 'complete' : '') + '"><div class="phase-name">' + marker + ' ' + esc(phase.id) + '</div><div class="phase-meta">' + esc(phase.family) + ' · loop ' + phase.loopCounter + '/' + phase.cap + '</div>' + stepsHtml + '</div>';
    }).join('');
    const select = $('next-phase'); const selected = select.value; select.innerHTML = '<option value="">current phase</option>' + (state.phases || []).filter((phase, index) => index >= state.currentPhaseIdx).map((phase) => '<option value="' + esc(phase.id) + '">' + esc(phase.id) + '</option>').join(''); select.value = selected;
    const sessionSelect = $('session-select'); const old = sessionSelect.value; sessionSelect.innerHTML = '<option value="">Select a session</option>' + (state.implementerSessions || []).map((session, index) => { const seq = index + 1; const time = (session.startedAt || '').slice(11, 19); const label = '#' + seq + ' ' + session.phaseId + ' run ' + session.runIdx + ' - ' + session.kind + ' - ' + session.status + (time ? ' - ' + time : ''); return '<option value="' + esc(session.sessionId) + '">' + esc(label) + '</option>'; }).reverse().join(''); sessionSelect.value = old;
    if ($('message').className === 'error') showMessage('');
  } catch (error) { showMessage(error.message, true); }
}
async function refreshQuestions() {
  try {
    const questions = await getJson('/api/questions');
    const current = new Set(questions.map((question) => question.id));
    if (questions.some((question) => !seenQuestions.has(question.id)) && 'Notification' in window && Notification.permission === 'granted') new Notification('opsx-flow question pending');
    seenQuestions = current;
    $('questions').innerHTML = questions.length ? questions.map((request) => '<article class="question"><h3>' + esc((request.questions[0] && request.questions[0].header) || request.phaseId || 'Question') + '</h3>' + request.questions.map((question) => '<p>' + esc(question.question) + '</p>' + (question.options && question.options.length ? '<ul>' + question.options.map((option) => '<li><strong>' + esc(option.label) + '</strong> — ' + esc(option.description) + '</li>').join('') + '</ul>' : '') + (question.custom ? '<div class="muted">Custom answer allowed</div>' : '')).join('') + '<div class="muted">Session: ' + esc(request.sessionID) + '</div><button onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent)">Copy open command</button><pre>' + esc(request.openCommand) + '</pre></article>').join('') : '<span class="muted">None</span>';
  } catch (error) { $('questions').innerHTML = '<span class="error">' + esc(error.message) + '</span>'; }
}
async function refreshLog() {
  try {
    const data = await getJson('/api/log' + (lastLog ? '?since=' + encodeURIComponent(lastLog) : ''));
    if (data.entries.length) {
      const fresh = data.entries.filter((entry) => {
        const key = entry.ts + '\u0000' + entry.event + '\u0000' + (entry.detail || '');
        if (seenLogEntries.has(key)) return false;
        seenLogEntries.add(key);
        return true;
      });
      $('events').innerHTML += fresh.map((entry) => '<div class="event">' + esc(entry.ts + '  ' + entry.event + (entry.detail ? ': ' + entry.detail : '')) + '</div>').join('');
      lastLog = data.entries[data.entries.length - 1].ts;
      if (seenLogEntries.size > 1000) seenLogEntries = new Set([...seenLogEntries].slice(-500));
    }
    while ($('events').children.length > 500) $('events').firstElementChild.remove();
  } catch (error) { showMessage(error.message, true); }
}
async function refreshProjects() { try { const data = await getJson('/api/projects'); $('known-projects').innerHTML = data.projects.map((project) => '<option value="' + esc(project) + '"></option>').join(''); } catch (_) {} }
async function refresh() { await Promise.all([refreshState(), refreshQuestions(), refreshLog()]); }
$('project-picker').onchange = () => { const project = $('project-picker').value.trim(); if (project) window.location.href = '/?projectDir=' + encodeURIComponent(project); };
$('pause').onclick = async () => { try { await getJson('/api/pause', {method:'POST'}); showMessage('Pause requested'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('continue').onclick = async () => { try { await getJson('/api/continue', {method:'POST'}); showMessage('Continue requested'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('stop').onclick = async () => { try { await getJson('/api/stop', {method:'POST'}); showMessage('Stop requested'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('resume').onclick = async () => { try { const nextPhase = $('next-phase').value; await getJson('/api/resume', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(nextPhase ? {nextPhase} : {})}); showMessage('Daemon resumed'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('session-select').onchange = async () => { if (!$('session-select').value) { $('report').textContent = 'Select a session to view its last assistant report.'; return; } try { const data = await getJson('/api/report?sessionId=' + encodeURIComponent($('session-select').value)); $('report').textContent = data.text || '(no assistant text)'; } catch (error) { $('report').textContent = error.message; } };
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
refreshProjects(); refresh(); setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

function createUiServer(projectDir: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      try {
        const attachedProjectDir = resolveUiProject(projectDir, url);
        if (request.method === "GET" && url.pathname === "/") return new Response(uiHtml(attachedProjectDir, port), { headers: { "content-type": "text/html; charset=utf-8" } });
        if (request.method === "GET" && url.pathname === "/api/state") return jsonResponse(await apiState(attachedProjectDir));
        if (request.method === "GET" && url.pathname === "/api/log") return jsonResponse(await apiLog(attachedProjectDir, url.searchParams.get("since") ?? undefined));
        if (request.method === "GET" && url.pathname === "/api/questions") return jsonResponse(await apiQuestions(attachedProjectDir));
        if (request.method === "GET" && url.pathname === "/api/projects") return jsonResponse({ projects: knownProjectDirs(attachedProjectDir) });
        if (request.method === "GET" && url.pathname === "/api/report") {
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) return jsonResponse({ error: "sessionId is required" }, 400);
          return jsonResponse(await apiReport(attachedProjectDir, sessionId));
        }
        if (request.method === "POST" && url.pathname === "/api/pause") {
          const state = await loadState(statePath(attachedProjectDir));
          if (state.workflowStatus === "completed") return jsonResponse({ error: "workflow is already completed" }, 409);
          writePauseMarker(attachedProjectDir, true);
          return jsonResponse(await apiState(attachedProjectDir));
        }
        if (request.method === "POST" && url.pathname === "/api/continue") {
          const state = await loadState(statePath(attachedProjectDir));
          if (state.workflowStatus === "completed") return jsonResponse({ error: "workflow is already completed" }, 409);
          await clearManualPause(attachedProjectDir, state);
          return jsonResponse(await apiState(attachedProjectDir));
        }
        if (request.method === "POST" && url.pathname === "/api/resume") {
          const body = await requestJson(request);
          const nextPhase = body.nextPhase === undefined ? undefined : stringValue(body.nextPhase, "nextPhase");
          const result = await resumeFlow(attachedProjectDir, nextPhase);
          return jsonResponse({ ...(await apiState(attachedProjectDir)), resumedPid: result.pid });
        }
        if (request.method === "POST" && url.pathname === "/api/stop") {
          try {
            await stopFlow(attachedProjectDir);
          } catch (error) {
            // The busy-session refusal is a client error (409); everything else
            // (missing state, driver errors) is a server error handled below.
            if (error instanceof BusySessionsError) return jsonResponse({ error: error.message }, 409);
            throw error;
          }
          return jsonResponse(await apiState(attachedProjectDir));
        }
        return jsonResponse({ error: "not found" }, 404);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`opsx-flow dashboard -- local web UI for opsx-flow workflows

Usage:
  bun .opencode/scripts/opsx-flow-dashboard.ts [--port <port>] [--project-dir <path>]

Options:
  --port <port>         HTTP port to listen on (default 4321)
  --project-dir <path>  Project whose workflow state to show (default: current git root)
  --help, -h            Show this help
`);
}

type DashboardOptions = { port: number; projectDir: string };

function parseArgs(args: string[]): DashboardOptions {
  rejectUnknownFlags(args, new Set(["--port", "--project-dir"]));
  const projectDir = resolveProjectDir(args);
  if (hasFlag(args, "--port") && (!valueFlag(args, "--port") || valueFlag(args, "--port")!.startsWith("--"))) {
    throw new Error("--port requires a value");
  }
  const portRaw = valueFlag(args, "--port");
  const port = portRaw === undefined ? 4321 : positiveInt(portRaw, "--port");
  if (port > 65535) throw new Error("--port must be between 1 and 65535");
  return { port, projectDir };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  const { port, projectDir } = parseArgs(argv);
  const server = createUiServer(projectDir, port);
  console.log(`opsx-flow dashboard listening at http://127.0.0.1:${server.port}/ (project ${projectDir})`);
  await new Promise<void>(() => undefined);
  return 0;
}

export const __test__ = {
  uiHtml,
  createUiServer,
  parseArgs,
};

const isMain = (() => {
  try {
    return (import.meta as { main?: boolean }).main === true;
  } catch {
    return false;
  }
})();

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("[opsx-flow-dashboard] fatal:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
