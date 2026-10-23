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
      stopDaemon(): Promise<string>
      update: {
        state(): Promise<{ version: string } | undefined>
        install(): Promise<void>
        onReady(listener: (update: { version: string }) => void): () => void
      }
      work: {
        info(): Promise<{ root: string; plugin: string; pluginExists: boolean }>
        newFolder(name: string): Promise<string>
        onOpenTask(listener: (sessionID: string) => void): () => void
      }
      schedules: {
        list(): Promise<LocalSchedule[]>
        preview(when: string): Promise<{ ok: true; times: number[] } | { ok: false; error: string }>
        save(input: ScheduleInput): Promise<LocalSchedule>
        remove(id: string): Promise<void>
        pause(id: string, paused: boolean): Promise<void>
        run(id: string): Promise<void>
        login(value?: boolean): Promise<boolean>
        onChange(listener: (list: LocalSchedule[]) => void): () => void
      }
      browser: BrowserBridge
      plugins: {
        list(): Promise<PluginConfig>
        save(entries: PluginEntry[]): Promise<PluginConfig>
      }
    }
  }
}

// The agent's browser, hosted in the main process (src/main/browser).
export type BrowserTab = {
  id: string
  url: string
  title: string
  loading: boolean
  loadError?: string
  canGoBack: boolean
  canGoForward: boolean
}
export type BrowserInventory = { tabs: BrowserTab[]; focusedTabID: string | null }
export type BrowserEvent =
  | { type: "state"; sessionID: string; state: BrowserInventory; error?: string }
  | { type: "embed"; sessionID: string; tabID: string; embed: string }
  | { type: "focus"; sessionID: string; tabID: string }
  | { type: "page"; sessionID: string; tabID: string; icon?: string; zoom: number }
  | { type: "status"; sessionID: string; status: "attaching" | "attached" | "closed"; reason?: string }
type Rect = { x: number; y: number; width: number; height: number }
export type BrowserBridge = {
  attach(sessionID: string, directory: string): Promise<void>
  detach(sessionID: string): Promise<void>
  state(
    sessionID: string,
  ): Promise<{ state: BrowserInventory; attached: boolean; embeds: Record<string, string> } | undefined>
  open(sessionID: string, url: string): Promise<void>
  navigate(sessionID: string, tabID: string, url: string): Promise<void>
  go(sessionID: string, tabID: string, direction: "back" | "forward" | "reload"): Promise<void>
  focus(sessionID: string, tabID: string): Promise<void>
  close(sessionID: string, tabID: string): Promise<void>
  layout(embed: string, rect: Rect | null): void
  hideAll(): void
  focusApp(): void
  onEvent(listener: (event: BrowserEvent) => void): () => void
}

// A scheduled work task kept by the app (src/main/schedules.ts).
export type LocalSchedule = {
  id: string
  name: string
  when: string
  mode: string
  prompt: string
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
export type ScheduleInput = Pick<LocalSchedule, "name" | "when" | "mode" | "prompt" | "folder"> & { id?: string }

export type PluginEntry = { package: string; options?: Record<string, unknown> }
// The daemon's plugin setup, from the global config folder (see src/main/plugins.ts).
export type PluginConfig = { file: string; entries: PluginEntry[]; files: string[]; v1: string[] }

export type Session = {
  id: string
  // Which project the daemon filed this session under. Sessions in different
  // subfolders of one checkout share it, which is what makes it the right thing
  // to group by rather than the raw directory.
  projectID?: string
  metadata?: Record<string, unknown>
  // A session is not guaranteed to have one: the daemon leaves it unset until
  // something names it, so anything reading this must handle its absence.
  title?: string
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
export type Project = { id: string; canonical: string; vcs?: string; time?: { active?: number } }
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

// The daemon asks through *forms*: a titled set of typed fields, answered with a
// map keyed by field. The view above is simpler — a list of questions answered
// with chosen labels — and it is the better thing to look at, so the two shapes
// are reconciled here at the boundary instead of pushing form plumbing into the UI.
type FormOption = { value: string; label: string; description?: string }
type FormField = {
  key: string
  type: "string" | "boolean" | "integer" | "number" | "multiselect" | "external"
  title?: string
  description?: string
  options?: FormOption[]
  custom?: boolean
  hidden?: boolean
}
type FormInfo = {
  id: string
  sessionID: string
  title: string
  metadata?: Record<string, unknown> & { messageID?: string; callID?: string }
  fields: FormField[]
}
type FormValue = string | number | boolean | string[]

function fromForm(form: FormInfo): QuestionRequest {
  const visible = form.fields.filter((field) => !field.hidden && field.type !== "external")
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions: visible.map((field) => ({
      question: field.title ?? field.key,
      header: form.title,
      options: (field.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? "",
      })),
      multiple: field.type === "multiselect",
      // A field with a fixed option list only takes free text when it says so;
      // anything else is open by nature.
      custom: field.options?.length ? (field.custom ?? false) : true,
    })),
    tool:
      form.metadata?.messageID && form.metadata?.callID
        ? { messageID: form.metadata.messageID, callID: form.metadata.callID }
        : undefined,
  }
}

/** Turn one question's chosen labels back into the value its field expects. */
function toFormValue(field: FormField, picked: string[]): FormValue {
  // The view works in labels because that is what the person read; the daemon
  // wants the value behind the label. Anything with no matching option is text
  // the person typed, which passes through as-is.
  const valueOf = (label: string) => field.options?.find((option) => option.label === label)?.value ?? label
  if (field.type === "multiselect") return picked.map(valueOf)
  const first = valueOf(picked[0] ?? "")
  if (field.type === "boolean") return first === "true" || first.toLowerCase() === "yes"
  if (field.type === "integer" || field.type === "number") {
    const parsed = Number(first)
    return Number.isFinite(parsed) ? parsed : first
  }
  return first
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
export type FileEntry = { path: string; type: "file" | "directory" }
export type Command = { name: string; template: string; description?: string; agent?: string }
export type RevertState = { messageID: string; diff?: string; files?: { file?: string; additions?: number; deletions?: number }[] }
export type Pty = { id: string; title: string; command: string; cwd: string; status: "running" | "exited"; exitCode?: number }

export type Skill = {
  id?: string
  name: string
  description?: string
  // Where the skill's file lives. The daemon reports it as `path`; `location` is the
  // older name, still read so a daemon on either naming shows a source.
  path?: string
  location?: string
  content?: string
}
export type Reference = {
  name: string
  path: string
  description?: string
  hidden?: boolean
  source: { type: "local"; path: string } | { type: "git"; repository: string; branch?: string }
}
// An "Always allow" rule remembered for a project.
export type SavedPermission = { id: string; projectID: string; action: string; resource: string }
export type LocationInfo = { directory: string; project: { id: string; directory: string } }

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
  async function patch(path: string, body: unknown) {
    const response = await fetch(connection.url + path, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${path}: ${await response.text()}`)
  }

  // Most routes wrap their payload as { location, data }.
  const data = async <T>(path: string, params?: Record<string, string>) =>
    ((await request(path, params)) as { data: T }).data

  return {
    url: connection.url,
    // Reaching `/api/info` at all is what "healthy" means — the daemon answers it
    // with its own identity, so a successful call also tells us which build and
    // process we are talking to. (There is no `/api/health`; asking for one and
    // treating the 404 as "offline" is what made the app declare the daemon lost
    // every few seconds.)
    health: async () => {
      const info = (await request("/api/info")) as { version: string; pid: number; urls?: string[] }
      return { healthy: true, pid: info.pid, version: info.version }
    },
    // The voice plugin runs its own helper session beside each one it talks to. Those
    // are its working space, not something to browse, so they stay out of the lists.
    sessions: async () =>
      (await data<Session[]>("/api/session", { limit: "200" })).filter(
        (session) => (session.metadata as { caimexVoice?: { role?: string } } | undefined)?.caimexVoice?.role !== "voice",
      ),
    session: (sessionID: string) => data<SessionDetail>(`/api/session/${sessionID}`),
    createSession: async (input: { directory: string; model?: ModelRef; agent?: string }) =>
      ((await post(`/api/session`, { location: { directory: input.directory }, model: input.model, agent: input.agent })) as {
        data: SessionDetail
      }).data,
    // Renaming is a field update on the session, not a verb of its own.
    rename: (sessionID: string, title: string) => patch(`/api/session/${sessionID}`, { title }),
    remove: (sessionID: string) => remove(`/api/session/${sessionID}`),
    setModel: (sessionID: string, model: ModelRef) => send(`/api/session/${sessionID}/model`, { model }),
    setAgent: (sessionID: string, agent: string) => send(`/api/session/${sessionID}/agent`, { agent }),
    // Without a folder, the daemon answers for its default location.
    agents: (directory?: string) =>
      data<Agent[]>("/api/agent", directory ? { "location[directory]": directory } : undefined),
    projects: () => data<Project[]>("/api/project"),
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
          // The prompt's fields sit at the top level of the body; wrapping them
          // in a `prompt` object is rejected outright, which is what stopped
          // every message from being sent.
          text,
          ...(files.length ? { files } : {}),
        })) as { data: { id: string } }
      ).data.id,
    interrupt: (sessionID: string) => send(`/api/session/${sessionID}/interrupt`),
    // Condense the history so a long session can keep going instead of running out
    // of window. The daemon does the summarising; this just asks for it.
    compact: (sessionID: string) => send(`/api/session/${sessionID}/compact`, {}),

    // Sessions with a run in progress, keyed by id. The authority on "busy": a run can
    // end (e.g. after a denied permission) without closing its assistant message.
    active: async () => Object.keys(await data<Record<string, unknown>>("/api/session/active")),

    integration: (id = "caimex") => data<Integration>(`/api/integration/${id}`),
    startSignIn: async (methodID: string, id = "caimex") =>
      ((await post(`/api/integration/${id}/connect/oauth`, { methodID, inputs: {} })) as { data: SignInAttempt }).data,
    // An attempt belongs to the integration that started it, so every call about
    // one is scoped under that integration rather than addressed on its own.
    signInStatus: (attemptID: string, id = "caimex") =>
      data<SignInStatus>(`/api/integration/${id}/connect/oauth/${attemptID}`),
    cancelSignIn: (attemptID: string, id = "caimex") =>
      remove(`/api/integration/${id}/connect/oauth/${attemptID}`),
    finishSignIn: (attemptID: string, code: string, id = "caimex") =>
      send(`/api/integration/${id}/connect/oauth/${attemptID}/complete`, { code }),
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
    // What the folder's agent has available: built-in and plugin-provided skills, and
    // project references (docs and repos it can consult).
    skills: (directory: string) => data<Skill[]>("/api/skill", { "location[directory]": directory }),
    references: (directory: string) => data<Reference[]>("/api/reference", { "location[directory]": directory }),
    location: (directory: string) =>
      request("/api/location", { "location[directory]": directory }) as Promise<LocationInfo>,
    savedPermissions: () => data<SavedPermission[]>("/api/permission/saved"),
    removeSavedPermission: (id: string) => remove(`/api/permission/saved/${id}`),
    // Messages the model currently sees: everything after the last compaction.
    context: (sessionID: string) => data<Message[]>(`/api/session/${sessionID}/context`),
    commands: (directory: string) => data<Command[]>("/api/command", { "location[directory]": directory }),
    // Warms a folder the daemon hasn't loaded yet (see sendPrompt's use).
    warm: (directory: string) => data<unknown[]>("/api/agent", { "location[directory]": directory }).then(() => {}),

    // Rewind: stage marks the point (keeping that message), commit drops everything after
    // it, clear abandons a staged rewind.
    stageRewind: async (sessionID: string, messageID: string) =>
      ((await post(`/api/session/${sessionID}/revert/stage`, { messageID, files: false })) as { data: RevertState }).data,
    commitRewind: (sessionID: string) => send(`/api/session/${sessionID}/revert/commit`),
    // Clearing a rewind is deleting the staged revert, not a command of its own.
    clearRewind: (sessionID: string) => remove(`/api/session/${sessionID}/revert`),

    ptyCreate: async (directory: string, input: { cwd: string; title?: string }) =>
      ((await post(`/api/pty?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, input)) as { data: Pty }).data,
    ptyList: (directory: string) => data<Pty[]>("/api/pty", { "location[directory]": directory }),
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

    questions: async (sessionID: string) =>
      (await data<FormInfo[]>(`/api/session/${sessionID}/form`)).map(fromForm),
    // One answer per question, each the list of chosen labels (or typed text).
    // The form is re-read first so labels are mapped against the fields the
    // daemon holds now, rather than a copy that may have moved on.
    answer: async (sessionID: string, requestID: string, answers: string[][]) => {
      const form = await data<FormInfo>(`/api/session/${sessionID}/form/${requestID}`)
      const visible = form.fields.filter((field) => !field.hidden && field.type !== "external")
      const answer: Record<string, FormValue> = {}
      visible.forEach((field, index) => {
        answer[field.key] = toFormValue(field, answers[index] ?? [])
      })
      await send(`/api/session/${sessionID}/form/${requestID}/reply`, { answer })
    },
    dismiss: (sessionID: string, requestID: string) => remove(`/api/session/${sessionID}/form/${requestID}`),
    permissions: (sessionID: string) => data<PermissionRequest[]>(`/api/session/${sessionID}/permission`),
    // The daemon takes the choice as `decision`; sending it as `reply` is rejected,
    // which left every permission prompt unanswerable.
    decide: (sessionID: string, requestID: string, decision: PermissionReply) =>
      send(`/api/session/${sessionID}/permission/${requestID}/reply`, { decision }),

    // Call a daemon plugin's RPC method (voice is one). A plugin reports failures as
    // an RpcError body carrying its own explanation — the gateway's refusal, say — and
    // that explanation is what's surfaced, not the HTTP status.
    rpc: async <T>(rpcID: string, method: string, input: unknown, directory?: string): Promise<T> => {
      const url = new URL(`${connection.url}/api/rpc/${rpcID}/${method}`)
      if (directory) url.searchParams.set("location[directory]", directory)
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ input }),
      })
      const text = await response.text()
      let body: { output?: T; message?: string; data?: { reason?: string; message?: string } } = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        // not JSON; the status line below says enough
      }
      if (!response.ok)
        throw new ApiError(response.status, body.data?.reason ?? body.data?.message ?? body.message ?? `${response.status} ${method}`)
      return body.output as T
    },

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
