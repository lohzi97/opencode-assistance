/**
 * Telegram Ping Plugin
 * 
 * Sends notifications to Telegram when specific OpenCode events occur, including:
 * - Permission requests (permission.asked)
 * - Session errors (session.error)
 * - Session idle timeout (session.idle)
 * - Question tool usage (tool.execute.before for question)
 * 
 * Setup Instructions:
 * 1. Create a Telegram bot by messaging @BotFather on Telegram
 * 2. Get your bot token from BotFather
 * 3. Start a conversation with your bot and send it a message
 * 4. Visit https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates to get your chat ID
 * 5. Create a config file at `.opencode/telegram-ping.jsonc` with your credentials
 * 
 * Configuration File Location:
 * `.opencode/telegram-ping.jsonc` in your project root
 * 
 * Example Configuration:
 * ```jsonc
 * {
 *   // Your Telegram bot token from @BotFather
 *   "botToken": "123456123789:ABCdefGH12343IjklMNO123123pqrsTUVwxyz",
 *   // Your Telegram chat ID (numeric string)
 *   "chatId": "123456789",
 *   // Enable/disable notifications (optional, defaults to true)
 *   "enabled": true
 * }
 * ```
 * 
 * Expected Behavior:
 * - If config file is missing: Logs error message "telegram-ping.jsonc not found" and disables plugin
 * - If config is invalid JSON: Logs error message with syntax details and disables plugin (silent failure, doesn't crash OpenCode)
 * - If botToken or chatId is missing: Logs error message "missing required fields (botToken and chatId are required)" and disables plugin
 * - If enabled is set to false: Logs info message "notifications disabled: enabled is set to false in telegram-ping.jsonc" and disables plugin
 * - If enabled is not specified: Defaults to true, plugin initializes normally
 * 
 * Field Descriptions:
 * - botToken (string, required): Telegram bot API token from @BotFather
 * - chatId (string, required): Telegram chat ID where notifications will be sent
 * - enabled (boolean, optional): Enable or disable the plugin (defaults to true)
 */

import type { Plugin } from "@opencode-ai/plugin"
import { basename } from "path"
import * as fs from "fs"
import * as path from "path"

function stripJsonComments(json: string): string {
  let result = ""
  let i = 0
  const len = json.length
  let inString = false
  let inSingleLineComment = false
  let inMultiLineComment = false
  let escapeNext = false

  while (i < len) {
    const char = json[i]

    if (escapeNext) {
      result += char
      escapeNext = false
      i++
      continue
    }

    if (inString) {
      if (char === "\\") {
        escapeNext = true
      } else if (char === '"') {
        inString = false
      }
      result += char
      i++
      continue
    }

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false
        result += char
      }
      i++
      continue
    }

    if (inMultiLineComment) {
      if (char === "*" && i + 1 < len && json[i + 1] === "/") {
        inMultiLineComment = false
        i += 2
        continue
      }
      i++
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === "/" && i + 1 < len && json[i + 1] === "/") {
      inSingleLineComment = true
      i += 2
      continue
    } else if (char === "/" && i + 1 < len && json[i + 1] === "*") {
      inMultiLineComment = true
      i += 2
      continue
    }

    result += char
    i++
  }

  return result
}

interface TelegramConfig {
  botToken?: string
  chatId?: string
  enabled?: boolean
}

interface LoadConfigResult {
  config: TelegramConfig
  error?: string
  errorType?: "notFound" | "parseError" | "missingFields"
}

function loadConfig(): LoadConfigResult {
  const configPath = path.join(process.cwd(), ".opencode", "telegram-ping.jsonc")
  
  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const strippedContent = stripJsonComments(content)
    const config = JSON.parse(strippedContent) as TelegramConfig
    
    if (!config.botToken || !config.chatId) {
      return {
        config,
        error: "missing required fields (botToken and chatId are required)",
        errorType: "missingFields"
      }
    }
    
    return { config }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        config: {},
        error: "telegram-ping.jsonc not found",
        errorType: "notFound"
      }
    }
    if (error instanceof SyntaxError) {
      return {
        config: {},
        error: `invalid JSON syntax: ${error.message}`,
        errorType: "parseError"
      }
    }
    return {
      config: {},
      error: String(error),
      errorType: "parseError"
    }
  }
}

export const TelegramPingPlugin: Plugin = async ({ client, project, directory }) => {
  const { config, error, errorType } = loadConfig()
  const botToken = config.botToken
  const chatId = config.chatId
  const enabled = config.enabled !== false
  const projectName = directory ? basename(directory) : null

  if (error && (!botToken || !chatId)) {
    await client.app.log({
      body: {
        service: "telegram-ping",
        level: "error",
        message: `telegram-ping.jsonc ${error}. Plugin disabled.`,
      },
    })
    return {}
  }

  if (!enabled) {
    await client.app.log({
      body: {
        service: "telegram-ping",
        level: "info",
        message: "Telegram notifications disabled: enabled is set to false in telegram-ping.jsonc",
      },
    })
    return {}
  }

  async function sendTelegramNotification(message: string) {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      })

      if (!response.ok) {
        await client.app.log({
          body: {
            service: "telegram-ping",
            level: "error",
            message: `Failed to send Telegram notification: ${response.statusText}`,
          },
        })
      }
    } catch (error) {
      await client.app.log({
        body: {
          service: "telegram-ping",
          level: "error",
          message: `Error sending Telegram notification: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    }
  }

  return {
    event: async ({ event }) => {
      if ((event as any).type === "permission.asked") {
        await sendTelegramNotification(`${projectName}: Asked for permission`)
      } else if (event.type === 'session.error') {
        await sendTelegramNotification(`${projectName}: Hit error`)
      } else if (event.type === 'session.idle') {
        await sendTelegramNotification(`${projectName}: Idle`)
      }
    },
    "tool.execute.before": async ({ tool }) => {
      if (tool === "question") {
        await sendTelegramNotification(`${projectName}: Asked question(s)`)
      }
    },
    "permission.ask": async (input, output) => {
      // got bug: https://github.com/anomalyco/opencode/issues/7006 
      // this is why now we use `(event as any).type === "permission.asked"` in event.
      await sendTelegramNotification(`OpenCode is asking for permission for ${projectName}`)
    },
  }
}
