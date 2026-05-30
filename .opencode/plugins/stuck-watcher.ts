/**
 * Stuck Watcher Plugin
 *
 * Detects sessions that stop producing output while still in "busy" status,
 * aborts them, and sends a "continue" prompt to resume work automatically.
 *
 * Activity is tracked via bus events:
 * - `message.part.delta`: streaming text deltas (text generation heartbeat)
 * - `message.part.updated`: visible part updates
 * - `session.status`: busy/idle transitions
 * - running `question` tool parts: interactive user wait, never stuck
 *
 * When no activity events fire for `stuck_threshold_ms` while a session is
 * busy, the watcher considers it stuck, aborts the session, and sends the
 * configured continue prompt via promptAsync.
 *
 * Configuration File Location:
 * `.opencode/stuck-watcher.jsonc`
 */

import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import fs from "node:fs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type StuckWatcherConfig = {
  enabled: boolean
  stuck_threshold_ms: number
  check_interval_ms: number
  continue_prompt: string
  cooldown_ms: number
  max_rescues_per_session: number
}

type RawConfig = Partial<StuckWatcherConfig> & {
  llm_stuck?: boolean
  llm_stuck_threshold_ms?: number
}

const CONFIG_FILE = "stuck-watcher.jsonc"
const PLUGIN_SERVICE = "stuck-watcher"

const DEFAULTS: StuckWatcherConfig = {
  enabled: true,
  stuck_threshold_ms: 60_000,
  check_interval_ms: 10_000,
  continue_prompt: "continue",
  cooldown_ms: 30_000,
  max_rescues_per_session: 5,
}

// ---------------------------------------------------------------------------
// JSONC stripper
// ---------------------------------------------------------------------------

function stripJsonComments(text: string): string {
  let out = ""
  let i = 0
  let inStr = false
  let inLine = false
  let inBlock = false
  let esc = false

  while (i < text.length) {
    const ch = text[i]
    const nx = text[i + 1]

    if (esc) {
      out += ch
      esc = false
      i++
      continue
    }

    if (inStr) {
      if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      out += ch
      i++
      continue
    }

    if (inLine) {
      if (ch === "\n") {
        inLine = false
        out += ch
      }
      i++
      continue
    }

    if (inBlock) {
      if (ch === "*" && nx === "/") {
        inBlock = false
        i += 2
        continue
      }
      i++
      continue
    }

    if (ch === '"') {
      inStr = true
    } else if (ch === "/" && nx === "/") {
      inLine = true
      i += 2
      continue
    } else if (ch === "/" && nx === "*") {
      inBlock = true
      i += 2
      continue
    }

    out += ch
    i++
  }

  return out
}

function loadConfig(directory: string): StuckWatcherConfig {
  const cfgPath = path.join(directory, ".opencode", CONFIG_FILE)
  try {
    const raw = fs.readFileSync(cfgPath, "utf-8")
    const parsed = JSON.parse(stripJsonComments(raw)) as RawConfig
    const threshold =
      typeof parsed.stuck_threshold_ms === "number" && parsed.stuck_threshold_ms > 0
        ? parsed.stuck_threshold_ms
        : typeof parsed.llm_stuck_threshold_ms === "number" && parsed.llm_stuck_threshold_ms > 0
          ? parsed.llm_stuck_threshold_ms
          : DEFAULTS.stuck_threshold_ms
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      stuck_threshold_ms: threshold,
      check_interval_ms:
        typeof parsed.check_interval_ms === "number" && parsed.check_interval_ms > 0
          ? parsed.check_interval_ms
          : DEFAULTS.check_interval_ms,
      continue_prompt:
        typeof parsed.continue_prompt === "string" && parsed.continue_prompt.trim()
          ? parsed.continue_prompt.trim()
          : DEFAULTS.continue_prompt,
      cooldown_ms:
        typeof parsed.cooldown_ms === "number" && parsed.cooldown_ms >= 0
          ? parsed.cooldown_ms
          : DEFAULTS.cooldown_ms,
      max_rescues_per_session:
        typeof parsed.max_rescues_per_session === "number" && parsed.max_rescues_per_session > 0
          ? parsed.max_rescues_per_session
          : DEFAULTS.max_rescues_per_session,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

// ---------------------------------------------------------------------------
// Per-session tracking
// ---------------------------------------------------------------------------

type SessionState = {
  busy: boolean
  lastLLMActivity: number
  rescueCount: number
  lastRescueAt: number
  rescuing: boolean
  activeQuestionParts: Set<string>
}

const GLOBAL_INSTANCE_KEY = Symbol.for("sebastian.stuck-watcher.instances")
const POST_ABORT_CONTINUE_DELAY_MS = 5_000

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const StuckWatcherPlugin: Plugin = async ({ client, directory }) => {
  const cfg = loadConfig(directory)
  const runtime = globalThis as Record<PropertyKey, unknown>
  const active = (() => {
    const current = runtime[GLOBAL_INSTANCE_KEY]
    if (current instanceof Set) return current as Set<string>
    const next = new Set<string>()
    runtime[GLOBAL_INSTANCE_KEY] = next
    return next
  })()

  if (!cfg.enabled) {
    await client.app.log({
      body: {
        service: PLUGIN_SERVICE,
        level: "info",
        message: "disabled (enabled=false in config)",
      },
    })
    return {}
  }

  if (active.has(directory)) {
    await client.app.log({
      body: {
        service: PLUGIN_SERVICE,
        level: "warn",
        message: `duplicate instance suppressed for ${directory}`,
      },
    })
    return {}
  }
  active.add(directory)

  await client.app.log({
    body: {
      service: PLUGIN_SERVICE,
      level: "info",
      message:
        `active — threshold=${cfg.stuck_threshold_ms / 1000}s, ` +
        `check every ${cfg.check_interval_ms / 1000}s, max ${cfg.max_rescues_per_session} rescues/session`,
    },
  })

  const sessions = new Map<string, SessionState>()
  let checking = false

  function getSession(sessionID: string): SessionState {
    let s = sessions.get(sessionID)
    if (!s) {
      s = {
        busy: false,
        lastLLMActivity: Date.now(),
        rescueCount: 0,
        lastRescueAt: 0,
        rescuing: false,
        activeQuestionParts: new Set(),
      }
      sessions.set(sessionID, s)
    }
    return s
  }

  function touchLLMActivity(sessionID: string) {
    const s = getSession(sessionID)
    s.lastLLMActivity = Date.now()
  }

  function isToolPart(part: unknown): part is {
    id?: string
    type: "tool"
    tool?: string
    state?: { status?: string }
  } {
    return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "tool"
  }

  function trackQuestionPart(sessionID: string, part: unknown) {
    if (!isToolPart(part) || part.tool !== "question" || !part.id) return
    const s = getSession(sessionID)
    if (part.state?.status === "running") {
      s.activeQuestionParts.add(part.id)
      return
    }
    s.activeQuestionParts.delete(part.id)
  }

  async function refreshActiveQuestionState(sessionID: string) {
    const s = getSession(sessionID)
    try {
      const messages = await client.session.messages({
        path: { id: sessionID },
        throwOnError: true,
      })
      const active = new Set<string>()
      for (const message of messages.data ?? []) {
        for (const part of message.parts ?? []) {
          if (isToolPart(part) && part.tool === "question" && part.id && part.state?.status === "running") {
            active.add(part.id)
          }
        }
      }
      s.activeQuestionParts = active
    } catch (err) {
      await client.app.log({
        body: {
          service: PLUGIN_SERVICE,
          level: "error",
          message: `failed to inspect question state for ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
        },
      })
    }
    return s.activeQuestionParts.size > 0
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function lastUserContext(sessionID: string) {
    try {
      const messages = await client.session.messages({
        path: { id: sessionID },
        throwOnError: true,
      })
      const list = messages.data ?? []
      for (let i = list.length - 1; i >= 0; i--) {
        const message = list[i]
        const text = message?.parts
          ?.filter((part): part is { type: "text"; text: string } => {
            return part?.type === "text" && typeof (part as { text?: unknown }).text === "string"
          })
          .map((part) => part.text)
          .join("\n")
          .trim()
        const info = list[i]?.info as
          | {
              role?: string
              agent?: string
              model?: { providerID?: string; modelID?: string; variant?: string }
            }
          | undefined
        if (info?.role !== "user") continue
        if (text === cfg.continue_prompt) continue
        if (!info.model?.providerID || !info.model?.modelID) continue
        return {
          agent: info.agent,
          model: {
            providerID: info.model.providerID,
            modelID: info.model.modelID,
          },
          variant: info.model?.variant,
        }
      }
    } catch (err) {
      await client.app.log({
        body: {
          service: PLUGIN_SERVICE,
          level: "error",
          message: `failed to inspect last user context for ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
        },
      })
    }
    return {}
  }

  // -----------------------------------------------------------------------
  // Periodic stuck check
  // -----------------------------------------------------------------------

  const timer = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      const now = Date.now()

      for (const [sessionID, state] of sessions) {
        if (!state.busy || state.rescuing) continue

        if (state.rescueCount >= cfg.max_rescues_per_session) continue

        if (state.activeQuestionParts.size > 0) continue

        const sinceLastRescue = now - state.lastRescueAt
        if (sinceLastRescue < cfg.cooldown_ms) continue

        const silenceMs = now - state.lastLLMActivity
        if (silenceMs < cfg.stuck_threshold_ms) continue

        if (await refreshActiveQuestionState(sessionID)) continue

        state.rescuing = true
        state.lastRescueAt = Date.now()
        state.lastLLMActivity = state.lastRescueAt
        state.rescueCount += 1
        const rescueIndex = state.rescueCount

        await client.app.log({
          body: {
            service: PLUGIN_SERVICE,
            level: "warn",
            message:
              `session ${sessionID} llm-stuck for ${Math.round(silenceMs / 1000)}s ` +
              `— aborting and sending "${cfg.continue_prompt}" ` +
              `(rescue ${rescueIndex}/${cfg.max_rescues_per_session})`,
          },
        })

        try {
          await client.session.abort({
            path: { id: sessionID },
            throwOnError: true,
          })
        } catch (err) {
          await client.app.log({
            body: {
              service: PLUGIN_SERVICE,
              level: "error",
              message: `abort failed for ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
            },
          })
          state.rescuing = false
          continue
        }

        await sleep(POST_ABORT_CONTINUE_DELAY_MS)

        try {
          const context = await lastUserContext(sessionID)
          await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              agent: context.agent,
              model: context.model,
              variant: context.variant,
              parts: [{ type: "text" as const, text: cfg.continue_prompt }],
            },
            throwOnError: true,
          })
          state.lastLLMActivity = Date.now()
        } catch (err) {
          await client.app.log({
            body: {
              service: PLUGIN_SERVICE,
              level: "error",
              message: `promptAsync failed for ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
            },
          })
        }

        state.rescuing = false
      }
    } finally {
      checking = false
    }
  }, cfg.check_interval_ms)

  // Ensure the timer does not prevent process exit
  if (timer.unref) timer.unref()

  // -----------------------------------------------------------------------
  // Event hook — track activity and session lifecycle
  // -----------------------------------------------------------------------

  return {
    event: async ({ event }) => {
      // Bus payloads are { type: string, properties: { sessionID, ... } }
      const evt = event as { type: string; properties?: Record<string, unknown> }
      const props = evt.properties

      switch (evt.type) {
        // Session becomes busy or idle
        case "session.status": {
          const sid = props?.sessionID as string | undefined
          const status = props?.status as { type: string } | undefined
          if (!sid) break
          const s = getSession(sid)
          if (status?.type === "idle") {
            s.busy = false
            s.rescuing = false
            s.activeQuestionParts.clear()
            s.lastLLMActivity = Date.now()
          } else if (status?.type === "busy") {
            s.busy = true
            s.lastLLMActivity = Date.now()
          }
          break
        }

        // Streaming text/reasoning delta — strong LLM heartbeat signal
        case "message.part.delta": {
          const sid = props?.sessionID as string | undefined
          if (sid) touchLLMActivity(sid)
          break
        }

        // Part updates count as visible progress.
        case "message.part.updated": {
          const sid = props?.sessionID as string | undefined
          if (!sid) break
          trackQuestionPart(sid, props?.part)
          touchLLMActivity(sid)
          break
        }

        // New or updated message — heartbeat
        case "message.updated": {
          const sid = props?.sessionID as string | undefined
          if (sid) touchLLMActivity(sid)
          break
        }

        // Session deleted — clean up tracking
        case "session.deleted": {
          const sid = props?.sessionID as string | undefined
          if (sid) sessions.delete(sid)
          break
        }
      }
    },
  }
}

export default StuckWatcherPlugin
