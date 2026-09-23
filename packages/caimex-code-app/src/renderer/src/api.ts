// A thin client for the v2 daemon. Everything the UI knows about the daemon's routes
// and payload shapes lives here, so upstream changes to the API land in one file.

export type Connection =
  | { ok: true; url: string; username: string; password: string }
  | { ok: false; error: string }

declare global {
  interface Window {
    caimex: {
      platform: string
      connect(): Promise<Connection>
      exists(path: string): Promise<boolean>
      pickFolder(): Promise<string | undefined>
      openExternal(url: string): Promise<void>
      setZoom(factor: number): void
      info(): Promise<{ version: string; packaged: boolean }>
      hermes: import("./hermes").HermesBridge
    }
  }
}

export type Session = {
  id: string
  title: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  time: { created: number; updated: number }
  location: { directory: string }
}

export type Model = {
  id: string
  providerID: string
  name: string
  capabilities?: { tools?: boolean; input?: string[]; output?: string[] }
  limit?: { context?: number }
}
export type ModelRef = { id: string; providerID: string }
export type Agent = { id: string; mode: string; description?: string; hidden?: boolean }
// The list endpoint omits these; GET /api/session/:id carries them.
export type SessionDetail = Session & { agent?: string; model?: ModelRef }

export type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }

export type TextPart = { type: "text"; id: string; text: string }
export type ReasoningPart = { type: "reasoning"; id: string; text: string; time?: { created: number; completed?: number } }
export type ToolPart = {
  type: "tool"
  id: string
  name: string
  state: {
    // "pending" while the model is still streaming the call's input
    status: "pending" | "running" | "completed" | "error" | (string & {})
    input?: Record<string, unknown>
    content?: { type: string; text?: string }[]
    structured?: Record<string, unknown>
    error?: { type?: string; message?: string }
  }
  time?: { created?: number; ran?: number; completed?: number }
}
export type Part = TextPart | ReasoningPart | ToolPart

export type UserMessage = { type: "user"; id: string; text: string; files?: unknown[]; time: { created: number } }
export type AssistantMessage = {
  type: "assistant"
  id: string
  agent?: string
  model?: { id: string; providerID: string }
  content: Part[]
  finish?: string
  tokens?: Tokens
  error?: { type?: string; message?: string }
  time: { created: number; completed?: number }
}
// The daemon also stores shell, synthetic, compaction and switch markers; the
// conversation view renders only the two it understands and skips the rest.
export type Message = UserMessage | AssistantMessage | { type: string; id: string; time: { created: number } }

export type QuestionOption = { label: string; description: string }
export type Question = {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  // Free-text answers are allowed unless the tool turns them off.
  custom?: boolean
}
export type QuestionRequest = {
  id: string
  sessionID: string
  questions: Question[]
  tool?: { messageID: string; callID: string }
}

export type PermissionRequest = {
  id: string
  sessionID: string
  // e.g. "bash", "edit", "external_directory"
  action: string
  resources: string[]
  // What "always" would remember
  save?: string[]
  metadata?: Record<string, unknown>
  source?: { type: string; messageID: string; callID: string }
}
export type PermissionReply = "once" | "always" | "reject"

export type IntegrationConnection =
  | { type: "credential"; id: string; label?: string }
  | { type: "env"; name: string }
export type Integration = {
  id: string
  name: string
  methods: { id?: string; type: string; label?: string; names?: string[] }[]
  connections: IntegrationConnection[]
}
export type SignInAttempt = {
  attemptID: string
  url: string
  instructions: string
  mode: "auto" | "code"
  time: { created: number; expires: number }
}
export type SignInStatus =
  | { status: "pending" }
  | { status: "complete" }
  | { status: "failed"; message: string }
  | { status: "expired" }

// ---------------------------------------------------------------------------
// v1-engine history. Stored rows as the daemon returns them; only the fields read below
// are relied on. Field names differ from v2 (filePath not path, output strings not
// content lists, tool metadata not structured results), so they are mapped here.

type LegacyPart = Record<string, unknown> & { type?: string; id?: string }
type LegacyMessage = { info: Record<string, unknown>; parts: LegacyPart[] }

const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

function legacyTool(part: LegacyPart): ToolPart {
  const state = record(part.state) ?? {}
  const input = { ...(record(state.input) ?? {}) }
  if (typeof input.filePath === "string" && input.path === undefined) input.path = input.filePath
  const metadata = record(state.metadata) ?? {}
  const structured: Record<string, unknown> = { ...metadata }
  if (typeof metadata.exit === "number") structured.exit = metadata.exit
  // v1 edits carry their unified diff in metadata.diff.
  const diff = text(metadata.diff)
  if (part.tool === "edit" && diff) {
    const filediff = record(metadata.filediff)
    structured.files = [
      {
        file: text(input.path),
        patch: diff,
        additions: typeof filediff?.additions === "number" ? filediff.additions : undefined,
        deletions: typeof filediff?.deletions === "number" ? filediff.deletions : undefined,
      },
    ]
  }
  const output = text(state.output)
  const time = record(state.time)
  // History can't still be running: a tool left pending or running was cut off. Report it
  // the way the daemon reports an interruption, so it renders as stopped.
  const unfinished = state.status === "pending" || state.status === "running"
  return {
    type: "tool",
    id: text(part.callID) ?? part.id ?? "",
    name: text(part.tool) ?? "tool",
    state: {
      status: unfinished ? "error" : (text(state.status) ?? "completed"),
      input,
      structured,
      content: output ? [{ type: "text", text: output }] : [],
      error: unfinished
        ? { message: "Tool execution interrupted" }
        : state.status === "error"
          ? { message: text(state.error) ?? "The tool failed." }
          : undefined,
    },
    time: { created: time?.start as number | undefined, completed: time?.end as number | undefined },
  }
}

function fromLegacy(message: LegacyMessage): Message[] {
  const info = message.info
  const id = text(info.id) ?? ""
  const time = record(info.time) ?? {}
  const created = typeof time.created === "number" ? time.created : 0
  if (info.role === "user") {
    // Synthetic parts are text the v1 engine injected, not what the person typed.
    const typed = message.parts.filter((part) => part.type === "text" && !part.synthetic).map((part) => text(part.text) ?? "")
    return typed.length ? [{ type: "user", id, text: typed.join("\n"), time: { created } }] : []
  }
  if (info.role !== "assistant") return []
  const content: Part[] = message.parts.flatMap((part): Part[] => {
    if (part.type === "text" && !part.synthetic) return [{ type: "text", id: part.id ?? "", text: text(part.text) ?? "" }]
    if (part.type === "reasoning") {
      const span = record(part.time)
      return [
        {
          type: "reasoning",
          id: part.id ?? "",
          text: text(part.text) ?? "",
          time: { created: (span?.start as number) ?? created, completed: (span?.end as number) ?? created },
        },
      ]
    }
    if (part.type === "tool") return [legacyTool(part)]
    return []
  })
  const error = record(info.error)
  const tokens = record(info.tokens) as Tokens | undefined
  return [
    {
      type: "assistant",
      id,
      agent: text(info.agent) ?? text(info.mode),
      model: text(info.modelID) ? { id: text(info.modelID)!, providerID: text(info.providerID) ?? "" } : undefined,
      content,
      finish: text(info.finish) ?? "stop",
      tokens,
      error: error ? { message: text(record(error.data)?.message) ?? text(error.name) } : undefined,
      // History is finished by definition, even a turn the v1 engine never closed.
      time: { created, completed: typeof time.completed === "number" ? time.completed : created },
    },
  ]
}

export type FileEntry = { path: string; type: "file" | "directory" }
export type Command = { name: string; template: string; description?: string; agent?: string }
export type RevertState = { messageID: string; diff?: string; files?: { file?: string; additions?: number; deletions?: number }[] }
export type Pty = { id: string; title: string; command: string; cwd: string; status: "running" | "exited"; exitCode?: number }

export const isUser = (message: Message): message is UserMessage => message.type === "user"
export const isAssistant = (message: Message): message is AssistantMessage => message.type === "assistant"

// A user-requested stop reaches us as a generic failure; the daemon only marks it by
// these fixed messages (core/src/session/runner/llm.ts).
export const isInterruption = (error: { message?: string } | undefined) =>
  error?.message === "Provider turn interrupted" || error?.message === "Tool execution interrupted"

// Live events arrive under the transitional `session.next.*` names this daemon emits.
export type DaemonEvent = {
  id: string
  type: string
  data: Record<string, unknown> & { sessionID?: string; timestamp?: number }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Api = ReturnType<typeof createApi>

export function createApi(connection: Extract<Connection, { ok: true }>) {
  const authorization = "Basic " + btoa(`${connection.username}:${connection.password}`)

  async function request(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(connection.url + path)
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
    const response = await fetch(url, { headers: { authorization } })
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${path}: ${await response.text()}`)
    return response.json()
  }

  async function post(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(connection.url + path, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${path}: ${await response.text()}`)
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }
  const send = async (path: string, body?: unknown) => void (await post(path, body))
  async function remove(path: string) {
    const response = await fetch(connection.url + path, { method: "DELETE", headers: { authorization } })
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${path}: ${await response.text()}`)
  }

  // Most routes wrap their payload as { location, data }.
  const data = async <T>(path: string, params?: Record<string, string>) =>
    ((await request(path, params)) as { data: T }).data

  return {
    url: connection.url,
    health: () => request("/api/health") as Promise<{ healthy: boolean; pid: number }>,
    sessions: () => data<Session[]>("/api/session", { limit: "200" }),
    session: (sessionID: string) => data<SessionDetail>(`/api/session/${sessionID}`),
    createSession: async (input: { directory: string; model?: ModelRef; agent?: string }) =>
      ((await post(`/api/session`, { location: { directory: input.directory }, model: input.model, agent: input.agent })) as {
        data: SessionDetail
      }).data,
    rename: (sessionID: string, title: string) => send(`/api/session/${sessionID}/rename`, { title }),
    remove: (sessionID: string) => remove(`/api/session/${sessionID}`),
    // History from the v1 engine, converted to the shapes the conversation view renders.
    legacyMessages: async (sessionID: string) => {
      const page = (await request(`/api/session/${sessionID}/legacy-message`, { limit: "500" })) as {
        data: LegacyMessage[]
        hasMore: boolean
      }
      return { messages: page.data.flatMap(fromLegacy), hasMore: page.hasMore }
    },
    setModel: (sessionID: string, model: ModelRef) => send(`/api/session/${sessionID}/model`, { model }),
    setAgent: (sessionID: string, agent: string) => send(`/api/session/${sessionID}/agent`, { agent }),
    agents: () => data<Agent[]>("/api/agent"),
    providers: () => data<{ id: string }[]>("/api/provider"),
    models: () => data<Model[]>("/api/model"),
    defaultModel: () => data<Model>("/api/model/default"),

    // Newest page first, returned oldest-to-newest.
    messages: async (sessionID: string, limit = 200) => {
      const page = await data<Message[]>(`/api/session/${sessionID}/message`, { limit: String(limit), order: "desc" })
      return { messages: page.reverse(), hasMore: page.length === limit }
    },
    firstMessage: async (sessionID: string) =>
      (await data<Message[]>(`/api/session/${sessionID}/message`, { limit: "1", order: "asc" }))[0],
    // Returns the admitted message id. Files are images as data: URIs; the gateway's
    // provider rejects any other attachment type, and a rejected one fails every later
    // turn in the session, so text files are referenced by @path in the text instead.
    prompt: async (sessionID: string, text: string, files: { uri: string; name: string }[] = []) =>
      (
        (await post(`/api/session/${sessionID}/prompt`, {
          prompt: files.length ? { text, files } : { text },
        })) as { data: { id: string } }
      ).data.id,
    interrupt: (sessionID: string) => send(`/api/session/${sessionID}/interrupt`),

    // Sessions with a run in progress, keyed by id. The authority on "busy": a run can
    // end (e.g. after a denied permission) without closing its assistant message.
    active: async () => Object.keys(await data<Record<string, unknown>>("/api/session/active")),

    integration: (id = "caimex") => data<Integration>(`/api/integration/${id}`),
    startSignIn: async (methodID: string, id = "caimex") =>
      ((await post(`/api/integration/${id}/connect/oauth`, { methodID, inputs: {} })) as { data: SignInAttempt }).data,
    signInStatus: (attemptID: string) => data<SignInStatus>(`/api/integration/attempt/${attemptID}`),
    cancelSignIn: (attemptID: string) => remove(`/api/integration/attempt/${attemptID}`),
    finishSignIn: (attemptID: string, code: string) => send(`/api/integration/attempt/${attemptID}/complete`, { code }),
    useKey: (key: string, id = "caimex") => send(`/api/integration/${id}/connect/key`, { key }),
    signOut: (credentialID: string) => remove(`/api/credential/${credentialID}`),

    // Folder-scoped routes take the folder as location[directory].
    findFiles: (directory: string, query: string, limit = 20) =>
      data<FileEntry[]>("/api/fs/find", { "location[directory]": directory, query, limit: String(limit) }),
    listDir: (directory: string, path = "") =>
      data<FileEntry[]>("/api/fs/list", { "location[directory]": directory, ...(path ? { path } : {}) }),
    readFile: async (directory: string, path: string) => {
      const url = new URL(`${connection.url}/api/fs/read/${path.split("/").map(encodeURIComponent).join("/")}`)
      url.searchParams.set("location[directory]", directory)
      const response = await fetch(url, { headers: { authorization } })
      if (!response.ok) throw new ApiError(response.status, `${response.status} reading ${path}`)
      return response.text()
    },
    commands: (directory: string) => data<Command[]>("/api/command", { "location[directory]": directory }),
    // Warms a folder the daemon hasn't loaded yet (see sendPrompt's use).
    warm: (directory: string) => data<unknown[]>("/api/agent", { "location[directory]": directory }).then(() => {}),

    // Rewind: stage marks the point (keeping that message), commit drops everything after
    // it, clear abandons a staged rewind.
    stageRewind: async (sessionID: string, messageID: string) =>
      ((await post(`/api/session/${sessionID}/revert/stage`, { messageID, files: false })) as { data: RevertState }).data,
    commitRewind: (sessionID: string) => send(`/api/session/${sessionID}/revert/commit`),
    clearRewind: (sessionID: string) => send(`/api/session/${sessionID}/revert/clear`),

    ptyCreate: async (directory: string, input: { cwd: string; title?: string }) =>
      ((await post(`/api/pty?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, input)) as { data: Pty }).data,
    ptyResize: (directory: string, id: string, size: { rows: number; cols: number }) =>
      fetch(`${connection.url}/api/pty/${id}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, {
        method: "PUT",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ size }),
      }).then(() => {}),
    ptyRemove: (directory: string, id: string) =>
      remove(`/api/pty/${id}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`),
    // WebSockets can't send an Authorization header; a short-lived ticket stands in.
    ptySocketUrl: async (directory: string, id: string) => {
      // The header is the daemon's CSRF guard for ticket requests.
      const response = await fetch(
        `${connection.url}/api/pty/${id}/connect-token?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
        { method: "POST", headers: { authorization, "x-opencode-ticket": "1" } },
      )
      if (!response.ok) throw new ApiError(response.status, `${response.status} terminal ticket`)
      const ticket = ((await response.json()) as { data: { ticket: string } }).data.ticket
      const url = new URL(`${connection.url.replace(/^http/, "ws")}/api/pty/${id}/connect`)
      url.searchParams.set("location[directory]", directory)
      url.searchParams.set("cursor", "0")
      url.searchParams.set("ticket", ticket)
      return url.toString()
    },

    questions: (sessionID: string) => data<QuestionRequest[]>(`/api/session/${sessionID}/question`),
    // One answer per question, each the list of chosen labels (or typed text).
    answer: (sessionID: string, requestID: string, answers: string[][]) =>
      send(`/api/session/${sessionID}/question/${requestID}/reply`, { answers }),
    dismiss: (sessionID: string, requestID: string) => send(`/api/session/${sessionID}/question/${requestID}/reject`),
    permissions: (sessionID: string) => data<PermissionRequest[]>(`/api/session/${sessionID}/permission`),
    decide: (sessionID: string, requestID: string, reply: PermissionReply) =>
      send(`/api/session/${sessionID}/permission/${requestID}/reply`, { reply }),

    // Server-sent events for every location. EventSource cannot send an
    // Authorization header, so this reads the stream by hand.
    events: async function* (signal: AbortSignal): AsyncGenerator<DaemonEvent> {
      const response = await fetch(connection.url + "/api/event", {
        headers: { authorization, accept: "text/event-stream" },
        signal,
      })
      if (!response.ok || !response.body) throw new ApiError(response.status, `${response.status} /api/event`)
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += value
        let end: number
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const payload = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (!payload) continue // heartbeat comment
          try {
            yield JSON.parse(payload) as DaemonEvent
          } catch {
            // a malformed frame is skipped rather than killing the stream
          }
        }
      }
    },
  }
}
