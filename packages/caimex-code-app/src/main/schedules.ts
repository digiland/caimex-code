import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, type BrowserWindow, ipcMain, Notification } from "electron"
import { connect } from "./daemon"
import { next, parse } from "./schedule-parse"
import { newFolder } from "./work"

// Scheduled work tasks. The v2 daemon has no scheduler, so the app keeps the schedules
// and, when one is due, starts an ordinary work task on the daemon: a session in the
// chosen mode, in a task folder, with the prompt. Runs happen while the app is open
// (closing the window doesn't quit it on macOS); anything due while it was closed runs
// once when it starts again.

export type Schedule = {
  id: string
  name: string
  // As typed: "every day at 8am", "0 8 * * 1-5", …
  when: string
  mode: string
  prompt: string
  // A new folder per run, or one folder every run adds to.
  folder: "new" | "same"
  directory?: string
  enabled: boolean
  createdAt: number
  nextRunAt?: number
  lastRunAt?: number
  lastStatus?: "running" | "done" | "failed"
  lastError?: string
  lastSessionID?: string
  runs: { at: number; sessionID?: string; status: "running" | "done" | "failed"; error?: string }[]
}

const file = () => join(app.getPath("userData"), "schedules.json")
let schedules: Schedule[] = []
let window: () => BrowserWindow | undefined = () => undefined

function load() {
  try {
    schedules = existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Schedule[]) : []
  } catch {
    schedules = []
  }
}

function save() {
  writeFileSync(file(), JSON.stringify(schedules, null, 2))
  const target = window()
  if (target && !target.isDestroyed()) target.webContents.send("schedules:changed", schedules)
}

const update = (id: string, patch: Partial<Schedule>) => {
  schedules = schedules.map((item) => (item.id === id ? { ...item, ...patch } : item))
  save()
}

function nextRun(schedule: Pick<Schedule, "when" | "createdAt">, after = Date.now()) {
  return next(parse(schedule.when, schedule.createdAt), after, schedule.createdAt)
}

// ---- talking to the daemon ------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function daemon() {
  const connection = await connect()
  if (!connection.ok) throw new Error(`The Caimex daemon isn't reachable: ${connection.error}`)
  const authorization = "Basic " + Buffer.from(`${connection.username}:${connection.password}`).toString("base64")
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(connection.url + path, {
      method,
      headers: { authorization, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${path}: ${text.slice(0, 200)}`)
    return (text ? JSON.parse(text) : undefined) as T
  }
}

type Message = { type: string; id: string; error?: { message?: string } }

const stamp = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

async function run(id: string) {
  const schedule = schedules.find((item) => item.id === id)
  if (!schedule || schedule.lastStatus === "running") return
  const at = Date.now()
  const record = (patch: Partial<Schedule["runs"][number]>) => {
    const current = schedules.find((item) => item.id === id)
    if (!current) return
    const runs = [...current.runs]
    const index = runs.findIndex((item) => item.at === at)
    const entry = { ...(index >= 0 ? runs[index] : { at, status: "running" as const }), ...patch }
    if (index >= 0) runs[index] = entry
    else runs.unshift(entry)
    update(id, {
      runs: runs.slice(0, 30),
      lastRunAt: at,
      lastStatus: entry.status,
      lastError: entry.error,
      lastSessionID: entry.sessionID ?? current.lastSessionID,
    })
  }
  record({ status: "running" })
  try {
    const call = await daemon()
    const directory =
      schedule.folder === "same" && schedule.directory && existsSync(schedule.directory)
        ? schedule.directory
        : newFolder(schedule.folder === "same" ? schedule.name : `${schedule.name} ${new Date(at).toISOString().slice(0, 10)}`)
    if (schedule.folder === "same" && schedule.directory !== directory) update(id, { directory })
    const location = `location%5Bdirectory%5D=${encodeURIComponent(directory)}`
    // A folder the daemon hasn't loaded yet drops its first prompt (see CLAUDE.md, "Open
    // daemon bug"); load it and let it settle first, as the app does for new sessions.
    await call("GET", `/api/agent?${location}`)
    await sleep(2500)
    const session = (
      await call<{ data: { id: string } }>("POST", "/api/session", { location: { directory }, agent: schedule.mode })
    ).data
    record({ sessionID: session.id })
    await call("POST", `/api/session/${session.id}/rename`, { title: `${schedule.name} · ${stamp(at)}` }).catch(() => {})
    const prompt = () => call("POST", `/api/session/${session.id}/prompt`, { prompt: { text: schedule.prompt } })
    await prompt()
    void follow(id, at, session.id, prompt, schedule.name, call)
  } catch (error) {
    record({ status: "failed", error: error instanceof Error ? error.message : String(error) })
    notify(`${schedule.name} couldn't start`, error instanceof Error ? error.message : String(error))
  }
}

// Watches a run until the daemon says it's no longer active, then records the outcome.
async function follow(
  id: string,
  at: number,
  sessionID: string,
  resend: () => Promise<unknown>,
  name: string,
  call: Awaited<ReturnType<typeof daemon>>,
) {
  const record = (status: "done" | "failed", error?: string) => {
    const current = schedules.find((item) => item.id === id)
    if (!current) return
    const runs = current.runs.map((item) => (item.at === at ? { ...item, status, error } : item))
    update(id, { runs, lastStatus: status, lastError: error })
  }
  const messages = async () =>
    (await call<{ data: Message[] }>("GET", `/api/session/${sessionID}/message?limit=5&order=desc`)).data
  let retried = false
  const started = Date.now()
  while (Date.now() - started < 3 * 60 * 60_000) {
    await sleep(10_000)
    const active = await call<{ data: Record<string, unknown> }>("GET", "/api/session/active").catch(() => undefined)
    if (!active) continue
    if (sessionID in active.data) continue
    const latest = await messages().catch(() => [] as Message[])
    const assistant = latest.find((message) => message.type === "assistant")
    if (!assistant) {
      // The first-prompt stall: admitted, never run. One fresh prompt usually gets it going.
      if (!retried && Date.now() - started > 15_000) {
        retried = true
        await resend().catch(() => {})
        continue
      }
      if (Date.now() - started < 60_000) continue
      record("failed", "The task never started on the daemon.")
      notify(`${name} didn't run`, "The task never started. Open it to retry.", sessionID)
      return
    }
    if (assistant.error?.message && !/interrupted/i.test(assistant.error.message)) {
      record("failed", assistant.error.message)
      notify(`${name} failed`, assistant.error.message, sessionID)
      return
    }
    record("done")
    notify(`${name} is ready`, "Open it to see the result.", sessionID)
    return
  }
  record("failed", "Still running after 3 hours; stopped watching it.")
}

function notify(title: string, body: string, sessionID?: string) {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.on("click", () => {
    const target = window()
    if (!target || target.isDestroyed()) return
    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
    if (sessionID) target.webContents.send("work:open-task", sessionID)
  })
  notification.show()
}

// ---- the clock ----------------------------------------------------------------

function tick() {
  const now = Date.now()
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextRunAt === undefined || schedule.nextRunAt > now) continue
    let upcoming: number | undefined
    try {
      upcoming = nextRun(schedule, now)
    } catch {
      upcoming = undefined
    }
    // A one-off is done once it has run.
    update(schedule.id, { nextRunAt: upcoming, enabled: upcoming !== undefined })
    void run(schedule.id)
  }
}

// ---- IPC ---------------------------------------------------------------------

type Input = Pick<Schedule, "name" | "when" | "mode" | "prompt" | "folder"> & { id?: string }

function validate(input: Input) {
  if (!input.name?.trim()) throw new Error("Give it a name.")
  if (!input.prompt?.trim()) throw new Error("Say what it should do.")
  parse(input.when)
}

export function registerSchedules(getWindow: () => BrowserWindow | undefined) {
  window = getWindow
  load()
  // Runs that were in progress when the app quit are no longer being watched.
  schedules = schedules.map((item) =>
    item.lastStatus === "running"
      ? { ...item, lastStatus: "failed", lastError: "The app closed while it was running." }
      : item,
  )
  ipcMain.handle("schedules:list", () => schedules)
  ipcMain.handle("schedules:preview", (_event, when: unknown) => {
    try {
      const createdAt = Date.now()
      const parsed = parse(String(when), createdAt)
      const times: number[] = []
      let cursor = createdAt
      for (let i = 0; i < 3; i++) {
        const upcoming = next(parsed, cursor, createdAt)
        if (upcoming === undefined) break
        times.push(upcoming)
        cursor = upcoming
      }
      return { ok: true, times }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle("schedules:save", (_event, input: Input) => {
    validate(input)
    const existing = input.id ? schedules.find((item) => item.id === input.id) : undefined
    const createdAt = existing && existing.when === input.when ? existing.createdAt : Date.now()
    const base: Schedule = existing ?? {
      id: crypto.randomUUID(),
      name: "",
      when: "",
      mode: "research",
      prompt: "",
      folder: "new",
      enabled: true,
      createdAt,
      runs: [],
    }
    const saved: Schedule = {
      ...base,
      name: input.name.trim(),
      when: input.when.trim(),
      mode: input.mode,
      prompt: input.prompt.trim(),
      folder: input.folder,
      directory: input.folder === base.folder ? base.directory : undefined,
      createdAt,
    }
    saved.nextRunAt = saved.enabled ? nextRun(saved) : undefined
    schedules = existing ? schedules.map((item) => (item.id === saved.id ? saved : item)) : [...schedules, saved]
    save()
    return saved
  })
  ipcMain.handle("schedules:remove", (_event, id: string) => {
    schedules = schedules.filter((item) => item.id !== id)
    save()
  })
  ipcMain.handle("schedules:pause", (_event, id: string, paused: boolean) => {
    const schedule = schedules.find((item) => item.id === id)
    if (!schedule) return
    update(id, { enabled: !paused, nextRunAt: paused ? undefined : nextRun(schedule) })
  })
  ipcMain.handle("schedules:run", (_event, id: string) => void run(id))
  // Opening at login keeps schedules running across restarts without the window.
  ipcMain.handle("schedules:login", (_event, value?: boolean) => {
    if (typeof value === "boolean") app.setLoginItemSettings({ openAtLogin: value, openAsHidden: true })
    return app.getLoginItemSettings().openAtLogin
  })

  // Catch up: anything that came due while the app was closed runs once now.
  setTimeout(tick, 15_000)
  setInterval(tick, 30_000)
}
