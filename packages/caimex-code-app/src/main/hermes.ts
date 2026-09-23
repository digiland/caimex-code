import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, ipcMain, safeStorage, type WebContents } from "electron"

// Hermes agents (the Work tab) are reached from here rather than from the renderer:
// Hermes only answers browser origins listed in its own config, and this way the API
// keys never enter the page. Keys are kept encrypted with the OS keychain's key.

export type AgentTarget = { id: string; baseURL: string; profile?: string }

const keysFile = () => join(app.getPath("userData"), "agent-keys.json")

function readKeys(): Record<string, string> {
  try {
    const stored = JSON.parse(readFileSync(keysFile(), "utf8")) as Record<string, string>
    return Object.fromEntries(
      Object.entries(stored).map(([id, value]) => [
        id,
        safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(value, "base64"))
          : Buffer.from(value, "base64").toString("utf8"),
      ]),
    )
  } catch {
    return {}
  }
}

function writeKeys(keys: Record<string, string>) {
  const encoded = Object.fromEntries(
    Object.entries(keys).map(([id, key]) => [
      id,
      (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, "utf8")).toString("base64"),
    ]),
  )
  writeFileSync(keysFile(), JSON.stringify(encoded), { mode: 0o600 })
}

function setKey(id: string, key: string | undefined) {
  const keys = readKeys()
  if (key?.trim()) keys[id] = key.trim()
  else delete keys[id]
  writeKeys(keys)
}

// The Hermes install on this machine: ~/.hermes/.env holds the API server's address and
// key, ~/.hermes/profiles its multiplexed profiles.
const HERMES_HOME = process.env.HERMES_HOME ?? join(homedir(), ".hermes")

function localEnv() {
  try {
    const values: Record<string, string> = {}
    for (const line of readFileSync(join(HERMES_HOME, ".env"), "utf8").split("\n")) {
      const match = /^\s*(API_SERVER_(?:KEY|HOST|PORT))\s*=\s*(.*?)\s*$/.exec(line)
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
    return values
  } catch {
    return undefined
  }
}

function localHermes() {
  const env = localEnv()
  if (!env) return { found: false as const }
  const host = !env.API_SERVER_HOST || env.API_SERVER_HOST === "0.0.0.0" ? "127.0.0.1" : env.API_SERVER_HOST
  const profilesDir = join(HERMES_HOME, "profiles")
  const profiles = existsSync(profilesDir)
    ? readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []
  return { found: true as const, baseURL: `http://${host}:${env.API_SERVER_PORT || "8642"}`, profiles, hasKey: !!env.API_SERVER_KEY }
}

function url(target: AgentTarget, path: string) {
  const base = new URL(target.baseURL)
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("An agent's address must be http or https.")
  const prefix = target.profile ? `p/${encodeURIComponent(target.profile)}/` : ""
  return new URL(`${base.pathname.replace(/\/?$/, "/")}${prefix}${path.replace(/^\//, "")}`, base).toString()
}

function headers(target: AgentTarget, extra?: Record<string, string>) {
  const key = readKeys()[target.id]
  if (!key) throw new Error("This agent has no API key yet. Add one in its settings.")
  return { Authorization: `Bearer ${key}`, ...extra }
}

async function request(target: AgentTarget, method: string, path: string, body?: unknown) {
  try {
    const response = await fetch(url(target, path), {
      method,
      headers: headers(target, body === undefined ? undefined : { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    const text = await response.text()
    let data: unknown = text
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      // not JSON; hand back the text
    }
    return { status: response.status, data }
  } catch (error) {
    return { status: 0, data: { error: { message: error instanceof Error ? error.message : String(error) } } }
  }
}

// Server-sent events, forwarded line by line to the window that asked.
const streams = new Map<string, AbortController>()

async function stream(sender: WebContents, streamID: string, target: AgentTarget, path: string) {
  const abort = new AbortController()
  streams.set(streamID, abort)
  const send = (channel: string, payload: unknown) => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }
  try {
    const response = await fetch(url(target, path), {
      headers: headers(target, { Accept: "text/event-stream" }),
      signal: abort.signal,
    })
    if (response.status !== 200 || !response.body) {
      send("hermes:end", { streamID, status: response.status })
      return
    }
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "")
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === "[DONE]") continue
        try {
          send("hermes:event", { streamID, data: JSON.parse(payload) })
        } catch {
          // a malformed line is skipped, not fatal
        }
      }
    }
    send("hermes:end", { streamID, status: 200 })
  } catch (error) {
    send("hermes:end", {
      streamID,
      status: 0,
      error: abort.signal.aborted ? undefined : error instanceof Error ? error.message : String(error),
    })
  } finally {
    streams.delete(streamID)
  }
}

// Scheduled-job results. Hermes' API lists jobs but not what they produced; the scheduler
// writes one Markdown file per run under <home>/cron/output/<job id>/. Only readable when
// the agent runs on this Mac, so only loopback addresses are answered.
const JOB_ID = /^[a-f0-9]{12}$/
const OUTPUT_NAME = /^[\w.-]+\.md$/

function outputDir(target: AgentTarget, jobID: string) {
  const host = new URL(target.baseURL).hostname
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host) || !JOB_ID.test(jobID)) return undefined
  if (target.profile && !/^[\w.-]+$/.test(target.profile)) return undefined
  const home = target.profile ? join(HERMES_HOME, "profiles", target.profile) : HERMES_HOME
  const dir = join(home, "cron", "output", jobID)
  return existsSync(dir) ? dir : undefined
}

function jobOutputs(target: AgentTarget, jobID: string) {
  const dir = outputDir(target, jobID)
  if (!dir) return undefined
  return readdirSync(dir)
    .filter((name) => OUTPUT_NAME.test(name))
    .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 30)
}

function jobOutput(target: AgentTarget, jobID: string, name: string) {
  const dir = outputDir(target, jobID)
  if (!dir || !OUTPUT_NAME.test(name)) return undefined
  const text = readFileSync(join(dir, name), "utf8")
  return text.length > 200_000 ? `${text.slice(0, 200_000)}\n\n… (truncated)` : text
}

const isTarget = (value: unknown): value is AgentTarget =>
  !!value &&
  typeof (value as AgentTarget).id === "string" &&
  typeof (value as AgentTarget).baseURL === "string" &&
  ((value as AgentTarget).profile === undefined || typeof (value as AgentTarget).profile === "string")

export function registerHermes() {
  ipcMain.handle("hermes:local", () => localHermes())
  ipcMain.handle("hermes:hasKey", (_event, id: unknown) => typeof id === "string" && !!readKeys()[id])
  ipcMain.handle("hermes:setKey", (_event, id: unknown, key: unknown) => {
    if (typeof id !== "string") return
    setKey(id, typeof key === "string" ? key : undefined)
  })
  // Copies this machine's Hermes key to an agent without it passing through the page.
  ipcMain.handle("hermes:useLocalKey", (_event, id: unknown) => {
    const key = localEnv()?.API_SERVER_KEY
    if (typeof id !== "string" || !key) return false
    setKey(id, key)
    return true
  })
  ipcMain.handle("hermes:request", (_event, target: unknown, method: unknown, path: unknown, body: unknown) => {
    if (!isTarget(target) || typeof method !== "string" || typeof path !== "string")
      return { status: 0, data: { error: { message: "Bad request" } } }
    return request(target, method, path, body)
  })
  ipcMain.handle("hermes:jobOutputs", (_event, target: unknown, jobID: unknown) =>
    isTarget(target) && typeof jobID === "string" ? jobOutputs(target, jobID) : undefined,
  )
  ipcMain.handle("hermes:jobOutput", (_event, target: unknown, jobID: unknown, name: unknown) =>
    isTarget(target) && typeof jobID === "string" && typeof name === "string" ? jobOutput(target, jobID, name) : undefined,
  )
  ipcMain.on("hermes:stream", (event, streamID: unknown, target: unknown, path: unknown) => {
    if (typeof streamID !== "string" || !isTarget(target) || typeof path !== "string") return
    void stream(event.sender, streamID, target, path).catch((error) =>
      event.sender.send("hermes:end", { streamID, status: 0, error: String(error) }),
    )
  })
  ipcMain.on("hermes:cancel", (_event, streamID: unknown) => {
    if (typeof streamID === "string") streams.get(streamID)?.abort()
  })
}
