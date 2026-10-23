// Hosts the agent's browser for this app: one set of tabs per session, attached to the
// daemon's browser plugin so the agent's browser tools drive pages the user can see.
//
// This is the part of Caimex Desktop's browser that couldn't be ported as-is (its
// gui-extensions/browser/pane.ts runs on Effect and the v2 client SDK). It follows the
// same protocol (version 4) and the same rules, re-expressed in plain TypeScript:
//
//   1. Subscribe to the daemon's events, wait for `server.connected`, then `attach`.
//      While attached, the daemon grants this session the `browser` permission.
//   2. A `control: command` event names a request; fetch it, run it on the right tab,
//      and post the outcome. A `control: cancel` aborts it.
//   3. Report the tab inventory whenever it changes — and before any result that
//      mentions a new tab, so the daemon can always resolve the IDs it's given. Every
//      send goes through one ordered queue to keep that true.
import http from "node:http"
import https from "node:https"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import electron, { type BrowserWindow } from "electron"
import { createBrowserPage, type BrowserPage, type PageDetail, type Shared } from "./chromium"
import type { Embeds } from "./embeds"
import { browserFailure } from "./errors"
import { fileURLWithin } from "./policy"
import * as Browser from "./protocol"

export type Connection = { url: string; username: string; password: string }

/** What the window hears about a session's browser. */
export type HostEvent =
  | { type: "state"; sessionID: string; state: Browser.State; error?: string }
  | { type: "embed"; sessionID: string; tabID: string; embed: string }
  | { type: "focus"; sessionID: string; tabID: string }
  | ({ type: "page"; sessionID: string; tabID: string } & PageDetail)
  | { type: "status"; sessionID: string; status: "attaching" | "attached" | "closed"; reason?: string }

type Entry = {
  sessionID: string
  connectionID: string
  directory: string
  win: BrowserWindow
  abort: AbortController
  partition: string
  pages: Map<string, BrowserPage>
  tabs: Map<string, Browser.Tab>
  focusedTabID: string | null
  requests: Map<string, { abort: AbortController; tabID?: string }>
  lastState?: string
  attached: boolean
  /** Sends to the daemon, run strictly in order. */
  outbound: Promise<void>
}

const auth = (c: Connection) => "Basic " + Buffer.from(`${c.username}:${c.password}`).toString("base64")

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
const bytes = (data: unknown) =>
  typeof data === "string" ? new Uint8Array(Buffer.from(data, "base64")) : (data as Uint8Array)

// Files cross the wire as base64; the pages work with bytes.
const decodeCommand = (command: Browser.Command): Browser.Command => ({
  ...command,
  files: (command.files ?? []).map((file) => ({ ...file, data: bytes(file.data) })),
})
const encodeOutcome = (outcome: Browser.Outcome) =>
  outcome.type === "success"
    ? {
        ...outcome,
        result: { ...outcome.result, files: outcome.result.files.map((file) => ({ ...file, data: base64(file.data) })) },
      }
    : outcome

/**
 * A request that may stay open for as long as the attachment lives. Node's fetch gives up
 * on a response whose headers take over five minutes, which would end every long session,
 * so the long-lived calls use node:http, which has no such limit.
 */
function longRequest(
  connection: Connection,
  path: string,
  options: { method: "GET" | "POST"; body?: unknown; signal: AbortSignal; onData?: (chunk: string) => void },
) {
  return new Promise<string>((resolve, reject) => {
    const url = new URL(connection.url + path)
    const client = url.protocol === "https:" ? https : http
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
    const request = client.request(
      url,
      {
        method: options.method,
        headers: {
          authorization: auth(connection),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(options.onData ? { accept: "text/event-stream" } : {}),
        },
        signal: options.signal,
      },
      (response) => {
        response.setEncoding("utf8")
        let text = ""
        response.on("data", (chunk: string) => (options.onData ? options.onData(chunk) : (text += chunk)))
        response.on("end", () =>
          (response.statusCode ?? 0) >= 400 ? reject(rpcError(response.statusCode ?? 0, text)) : resolve(text),
        )
        response.on("error", reject)
      },
    )
    request.on("error", reject)
    if (payload) request.write(payload)
    request.end()
  })
}

class RpcError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

function rpcError(status: number, text: string) {
  try {
    const body = JSON.parse(text) as { type?: string; message?: string }
    return new RpcError(status, body.type, body.message ?? `${status}`)
  } catch {
    return new RpcError(status, undefined, `${status} ${text.slice(0, 200)}`)
  }
}

/** Element refs never repeat, even across restarts: a ref quoted in a message stays unambiguous. */
function createRefs(file: string) {
  const block = 10_000
  let next = 0
  try {
    next = Number(JSON.parse(readFileSync(file, "utf8")).end) || 0
  } catch {
    // first run, or unreadable: start from zero
  }
  let end = next
  return () => {
    if (next >= end) {
      end = next + block
      try {
        writeFileSync(file, JSON.stringify({ end }))
      } catch {
        // not persisted: refs still never repeat within this run
      }
    }
    return `e${++next}`
  }
}

export function createBrowserHost(input: {
  connection: () => Connection | undefined
  embeds: Embeds
  emit: (event: HostEvent) => void
}) {
  const entries = new Map<string, Entry>()
  const shared: Shared = { ref: createRefs(join(electron.app.getPath("userData"), "browser-refs.json")) }

  const location = (entry: Entry) => `location%5Bdirectory%5D=${encodeURIComponent(entry.directory)}`

  /** One RPC call to the daemon's browser plugin. */
  async function rpc<T>(entry: Entry, method: string, body: Record<string, unknown>): Promise<T> {
    const connection = input.connection()
    if (!connection) throw new RpcError(0, "rpc.unavailable", "Not connected to the daemon")
    const response = await fetch(`${connection.url}/api/rpc/${Browser.RPC_ID}/${method}?${location(entry)}`, {
      method: "POST",
      headers: { authorization: auth(connection), "content-type": "application/json" },
      body: JSON.stringify({ input: { sessionID: entry.sessionID, connectionID: entry.connectionID, ...body } }),
    })
    const text = await response.text()
    if (!response.ok) throw rpcError(response.status, text)
    return (text ? (JSON.parse(text) as { output: T }).output : undefined) as T
  }

  /** Queue a send behind everything sent before it. Failures are logged, never thrown. */
  function send(entry: Entry, task: () => Promise<unknown>) {
    entry.outbound = entry.outbound.then(
      () => task().then(() => undefined),
      () => undefined,
    )
    entry.outbound = entry.outbound.catch((error) => console.warn("[browser] send failed", error))
  }

  function inventory(entry: Entry): Browser.State {
    return {
      tabs: Array.from(entry.tabs, ([id, tab]) => entry.pages.get(id)?.state() ?? tab),
      focusedTabID: entry.focusedTabID as Browser.TabID | null,
    }
  }

  /**
   * Report the inventory: to the daemon first (retrying until it lands or the attachment
   * ends), then to the window. Unchanged states are not resent.
   */
  function publishState(entry: Entry, error?: string) {
    const state = inventory(entry)
    const key = JSON.stringify({ state, error })
    if (entry.lastState === key) return
    entry.lastState = key
    const local = () => input.emit({ type: "state", sessionID: entry.sessionID, state, ...(error ? { error } : {}) })
    if (!entry.attached) return local()
    send(entry, async () => {
      for (let delay = 250; !entry.abort.signal.aborted; delay = Math.min(delay * 2, 10_000)) {
        try {
          await rpc(entry, "state", { state })
          break
        } catch (cause) {
          // "unavailable": the daemon already dropped this attachment; attach reports why.
          if (cause instanceof RpcError && cause.type === "unavailable") break
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
      local()
    })
  }

  function focus(entry: Entry, tabID: string) {
    entry.focusedTabID = tabID
    publishState(entry)
    input.emit({ type: "focus", sessionID: entry.sessionID, tabID })
  }

  function create(entry: Entry, initialize = true, popupOptions?: Electron.BrowserWindowConstructorOptions) {
    const id = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
    const fail = () => {
      if (entry.pages.has(id)) void closePage(entry, id, "page_crashed").catch(() => undefined)
    }
    const page = createBrowserPage(entry.win, {
      id,
      partition: entry.partition,
      network: null,
      initialize,
      popupOptions,
      // The agent can already read this folder, so letting its pages load files from it
      // grants nothing new; anything outside stays blocked.
      fileRoots: () => [entry.directory],
      shared,
      embeds: input.embeds,
      fail,
      publish: (error) => {
        if (entry.pages.has(id)) publishState(entry, error)
      },
      detail: (detail) => {
        if (entry.pages.has(id)) input.emit({ type: "page", sessionID: entry.sessionID, tabID: id, ...detail })
      },
      zoomed: () => entry.pages.forEach((other) => other.detail()),
      popup: (options, background) => {
        const popup = create(entry, false, options)
        if (!background) focus(entry, popup.state().id)
        return popup.contents
      },
    })
    entry.pages.set(id, page)
    entry.tabs.set(id, page.state())
    input.emit({ type: "embed", sessionID: entry.sessionID, tabID: id, embed: page.embed })
    void page.ready.then(() => entry.pages.get(id) === page && publishState(entry)).catch(fail)
    return page
  }

  async function closePage(entry: Entry, tabID: string, error?: string) {
    if (!entry.tabs.has(tabID))
      throw new Error("This tab is no longer available. Call browser.tabs.list({}) and use an existing tabID from this session.")
    const page = entry.pages.get(tabID)
    const focused = entry.focusedTabID === tabID
    entry.requests.forEach((request) => request.tabID === tabID && request.abort.abort())
    entry.pages.delete(tabID)
    entry.tabs.delete(tabID)
    if (focused) entry.focusedTabID = entry.tabs.keys().next().value ?? null
    if (page) await page.dispose()
    publishState(entry, error)
  }

  /** Run one command. Tab management happens here; everything else runs on its page. */
  async function execute(entry: Entry, command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
    const action = command.action
    if (signal.aborted)
      throw new Error("Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.")
    if (action.type === "tabs.list") return { value: inventory(entry), files: [] }
    if (action.type === "preview")
      throw new Error("Previewing files isn't available in Caimex Code's browser yet. Open the file's path with tabs.open instead.")
    if (action.type === "tabs.open") {
      const page = create(entry)
      if (action.focus !== false) focus(entry, page.state().id)
      await page.ready
      await page.execute(
        { action: { type: "navigate", tabID: page.state().id, url: action.url ?? "about:blank" }, files: [] },
        signal,
      )
      publishState(entry)
      return { value: page.state(), files: [] }
    }
    const tab = inventory(entry).tabs.find((item) => item.id === action.tabID)
    if (!tab)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )
    if (action.type === "tabs.focus") {
      focus(entry, action.tabID)
      return { value: tab, files: [] }
    }
    if (action.type === "tabs.close") {
      await closePage(entry, action.tabID)
      return { value: inventory(entry), files: [] }
    }
    const page = entry.pages.get(action.tabID)
    if (!page) throw new Error("Browser tab is unavailable. Call browser.tabs.list({}) for current tabs.")
    await page.ready
    const result = await page.execute(command, signal)
    publishState(entry)
    return result
  }

  async function onCommand(entry: Entry, requestID: string) {
    const abort = new AbortController()
    entry.requests.set(requestID, { abort })
    try {
      const command = decodeCommand(await rpc<Browser.Command>(entry, "command", { requestID }))
      if ("tabID" in command.action) entry.requests.set(requestID, { abort, tabID: command.action.tabID })
      const outcome: Browser.Outcome = await execute(entry, command, abort.signal).then(
        (result) => ({ type: "success", result }),
        (cause: unknown) => browserFailure(command.action, cause),
      )
      send(entry, () => rpc(entry, "result", { requestID, outcome: encodeOutcome(outcome) }))
    } catch (cause) {
      // A request that vanished (cancelled before it was fetched) fails only itself.
      if (!abort.signal.aborted) console.warn("[browser] command failed", cause)
    } finally {
      entry.requests.delete(requestID)
    }
  }

  /** Read the daemon's event stream, handing this attachment's control messages over. */
  function listen(entry: Entry, connection: Connection, connected: () => void) {
    let buffer = ""
    return longRequest(connection, "/api/event", {
      method: "GET",
      signal: entry.abort.signal,
      onData: (chunk) => {
        buffer += chunk
        let end: number
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const payload = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (!payload) continue
          let event: { type?: string; data?: Record<string, unknown> }
          try {
            event = JSON.parse(payload)
          } catch {
            continue
          }
          if (event.type === "server.connected") connected()
          if (event.type !== `rpc.${Browser.RPC_ID}.control`) continue
          const message = event.data as Browser.Control | undefined
          if (!message || message.connectionID !== entry.connectionID) continue
          if (message.type === "attached") {
            entry.attached = true
            input.emit({ type: "status", sessionID: entry.sessionID, status: "attached" })
            entry.lastState = undefined
            publishState(entry)
          } else if (message.type === "cancel") entry.requests.get(message.requestID)?.abort.abort()
          else if (message.type === "command") void onCommand(entry, message.requestID)
        }
      },
    })
  }

  function close(entry: Entry, reason?: string) {
    if (entries.get(entry.sessionID) !== entry) return
    entries.delete(entry.sessionID)
    entry.requests.forEach((request) => request.abort.abort())
    entry.requests.clear()
    entry.pages.forEach((page) => void page.dispose().catch(() => undefined))
    entry.pages.clear()
    entry.tabs.clear()
    entry.focusedTabID = null
    entry.attached = false
    input.emit({ type: "state", sessionID: entry.sessionID, state: { tabs: [], focusedTabID: null } })
    input.emit({ type: "status", sessionID: entry.sessionID, status: "closed", reason })
    entry.abort.abort()
  }

  return {
    /** Give a session its browser, attached to the daemon. Safe to call again. */
    async attach(win: BrowserWindow, sessionID: string, directory: string) {
      const existing = entries.get(sessionID)
      if (existing) {
        existing.lastState = undefined
        publishState(existing)
        return
      }
      const connection = input.connection()
      if (!connection) throw new Error("Not connected to the Caimex daemon")
      const entry: Entry = {
        sessionID,
        connectionID: crypto.randomUUID(),
        directory,
        win,
        abort: new AbortController(),
        partition: `caimex-browser-${crypto.randomUUID()}`,
        pages: new Map(),
        tabs: new Map(),
        focusedTabID: null,
        requests: new Map(),
        attached: false,
        outbound: Promise.resolve(),
      }
      entries.set(sessionID, entry)
      // Documents are guarded by navigation policy; subresources (images, scripts, fetches)
      // must not read files outside the session's folder either.
      electron.session
        .fromPartition(entry.partition)
        .webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) =>
          callback({ cancel: !fileURLWithin(details.url, [entry.directory]) }),
        )
      input.emit({ type: "status", sessionID, status: "attaching" })

      let ready!: () => void
      const connected = new Promise<void>((resolve) => (ready = resolve))
      const events = listen(entry, connection, () => ready()).catch((cause) => {
        if (!entry.abort.signal.aborted) close(entry, String(cause instanceof Error ? cause.message : cause))
      })
      void events
      await connected
      // Held open for the life of the attachment; it settles "closed" or "replaced".
      void longRequest(connection, `/api/rpc/${Browser.RPC_ID}/attach?${location(entry)}`, {
        method: "POST",
        body: { input: { sessionID, connectionID: entry.connectionID, version: Browser.VERSION } },
        signal: entry.abort.signal,
      }).then(
        (text) => close(entry, (JSON.parse(text || "{}") as { output?: string }).output),
        (cause: unknown) => {
          if (entry.abort.signal.aborted) return
          const unsupported = cause instanceof RpcError && /method_not_found|unavailable|invalid_input/.test(cause.type ?? "")
          close(entry, unsupported ? "unsupported" : String(cause instanceof Error ? cause.message : cause))
        },
      )
    },

    detach(sessionID: string) {
      const entry = entries.get(sessionID)
      if (entry) close(entry, "closed")
    },

    // What the person does in the pane, outside the agent's commands.
    async open(sessionID: string, url: string) {
      const entry = entries.get(sessionID)
      if (!entry) return
      const page = create(entry)
      focus(entry, page.state().id)
      await page.ready
      await page.execute({ action: { type: "navigate", tabID: page.state().id, url }, files: [] }, new AbortController().signal)
      publishState(entry)
    },
    async navigate(sessionID: string, tabID: string, url: string) {
      const entry = entries.get(sessionID)
      const page = entry?.pages.get(tabID)
      if (!entry || !page) return
      await page.execute({ action: { type: "navigate", tabID, url }, files: [] }, new AbortController().signal)
      publishState(entry)
    },
    async go(sessionID: string, tabID: string, direction: "back" | "forward" | "reload") {
      const entry = entries.get(sessionID)
      const page = entry?.pages.get(tabID)
      if (!entry || !page) return
      await page.execute({ action: { type: direction, tabID }, files: [] }, new AbortController().signal).catch(() => undefined)
      publishState(entry)
    },
    focus(sessionID: string, tabID: string) {
      const entry = entries.get(sessionID)
      if (entry?.tabs.has(tabID)) focus(entry, tabID)
    },
    async closeTab(sessionID: string, tabID: string) {
      const entry = entries.get(sessionID)
      if (entry) await closePage(entry, tabID).catch(() => undefined)
    },
    state(sessionID: string) {
      const entry = entries.get(sessionID)
      if (!entry) return undefined
      const embeds = Object.fromEntries(Array.from(entry.pages, ([id, page]) => [id, page.embed]))
      return { state: inventory(entry), attached: entry.attached, embeds }
    },
    disposeAll() {
      for (const entry of [...entries.values()]) close(entry, "closed")
    },
  }
}
