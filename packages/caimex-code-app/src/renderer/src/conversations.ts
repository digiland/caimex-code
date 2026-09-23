import { createStore, produce } from "solid-js/store"
import {
  isAssistant,
  type Api,
  type AssistantMessage,
  type DaemonEvent,
  type Message,
  type Part,
  type PermissionRequest,
  type QuestionRequest,
  type ReasoningPart,
  type TextPart,
  type ToolPart,
} from "./api"

export type Attachment = { uri: string; name: string }
export type Pending = { key: string; text: string; time: number; files: Attachment[] }
// A prompt the daemon accepted but never started answering (see `watch`).
export type Stalled = { messageID: string; text: string; files: Attachment[] }

export type Conversation = {
  status: "loading" | "ready" | "error"
  error?: string
  messages: Message[]
  // Prompts sent from here that the daemon has not yet echoed back as `prompted`.
  pending: Pending[]
  hasMore: boolean
  // Open requests the agent is blocked on until someone answers.
  questions: QuestionRequest[]
  permissions: PermissionRequest[]
  // History from the v1 engine, read-only: shown above, but not part of the model's context.
  legacy: Message[]
  legacyHasMore: boolean
  stalled?: Stalled
}

const PREFIX = "session.next."
const SETTLE_MS = 2500
const STALL_MS = 10_000
const REQUESTS = ["question.v2.", "permission.v2."]

// `api` is read on every call: after a daemon restart the app swaps in a new client.
export function createConversations(api: () => Api) {
  const [state, setState] = createStore<Record<string, Conversation>>({})
  // Events for a session whose history is still loading, replayed once it lands.
  const queued = new Map<string, DaemonEvent[]>()
  let sent = 0
  const watchers = new Map<string, ReturnType<typeof setTimeout>>()

  async function load(sessionID: string, options: { force?: boolean; directory?: string } = {}) {
    const current = state[sessionID]
    if (current && !options.force && current.status !== "error") return
    queued.set(sessionID, [])
    if (!current)
      setState(sessionID, {
        status: "loading",
        messages: [],
        pending: [],
        hasMore: false,
        questions: [],
        permissions: [],
        legacy: [],
        legacyHasMore: false,
      })
    else setState(sessionID, { status: "loading", error: undefined })
    try {
      const [page, questions, permissions] = await Promise.all([
        api().messages(sessionID),
        api().questions(sessionID).catch(() => []),
        api().permissions(sessionID).catch(() => []),
      ])
      // Only sessions without v2 history can have any from before the v2 reset.
      const legacy =
        page.messages.length === 0
          ? await api().legacyMessages(sessionID).catch(() => ({ messages: [], hasMore: false }))
          : { messages: [], hasMore: false }
      setState(sessionID, {
        status: "ready",
        messages: page.messages,
        hasMore: page.hasMore,
        questions,
        permissions,
        legacy: legacy.messages,
        legacyHasMore: legacy.hasMore,
      })
      // Deltas are skipped on replay: the history already holds some of that text and
      // each part's `ended` event carries the authoritative full text anyway.
      for (const event of queued.get(sessionID) ?? []) if (!event.type.endsWith(".delta")) apply(event)
    } catch (error) {
      // The daemon answers a session whose folder was deleted with a bare 500, which the
      // browser then reports as a CORS failure. Say what actually happened.
      const gone = options.directory !== undefined && !(await window.caimex.exists(options.directory))
      setState(sessionID, {
        status: "error",
        error: gone
          ? `The folder this session ran in no longer exists: ${options.directory}`
          : error instanceof Error
            ? error.message
            : String(error),
      })
    } finally {
      queued.delete(sessionID)
    }
  }

  function apply(event: DaemonEvent) {
    const request = REQUESTS.some((prefix) => event.type.startsWith(prefix))
    if (!event.type.startsWith(PREFIX) && !request) return
    const sessionID = event.data.sessionID
    if (!sessionID) return
    const waiting = queued.get(sessionID)
    if (waiting) {
      waiting.push(event)
      return
    }
    if (state[sessionID]?.status !== "ready") return
    if (request) {
      applyRequest(sessionID, event)
      return
    }
    const kind = event.type.slice(PREFIX.length)
    if (kind === "step.started") {
      clearTimeout(watchers.get(sessionID))
      watchers.delete(sessionID)
      if (state[sessionID].stalled) setState(sessionID, "stalled", undefined)
    }
    // The echo may come from another client (the CLI, the other desktop app), so only
    // clear a pending prompt this window actually sent.
    if (kind === "prompted") {
      const text = (event.data.prompt as { text?: string } | undefined)?.text
      const index = state[sessionID].pending.findIndex((item) => item.text === text)
      if (index !== -1) setState(sessionID, "pending", (pending) => pending.filter((_, i) => i !== index))
    }
    setState(sessionID, "messages", produce((messages) => reduce(messages, kind, event.data)))
  }

  // `fresh`: the session's folder was only just loaded by the daemon. Its first run can
  // go out before the folder's provider setup settles and fail silently (the daemon
  // records the message but never answers). Letting the folder settle first avoids it.
  async function send(
    sessionID: string,
    text: string,
    options: { files?: Attachment[]; fresh?: { directory: string } } = {},
  ) {
    const files = options.files ?? []
    const pending = { key: `pending-${++sent}`, text, time: Date.now(), files }
    setState(sessionID, "pending", (list) => [...list, pending])
    setState(sessionID, "stalled", undefined)
    try {
      if (options.fresh) {
        await api().warm(options.fresh.directory).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      }
      const messageID = await api().prompt(sessionID, text, files)
      watch(sessionID, { messageID, text, files })
    } catch (error) {
      setState(sessionID, "pending", (list) => list.filter((item) => item.key !== pending.key))
      throw error
    }
  }

  // If no reply has started a while after the daemon accepted a prompt, it was dropped
  // (the failure above, or any other silent one). Say so instead of spinning forever.
  function watch(sessionID: string, prompt: Stalled) {
    clearTimeout(watchers.get(sessionID))
    watchers.set(
      sessionID,
      setTimeout(() => {
        watchers.delete(sessionID)
        const messages = state[sessionID]?.messages ?? []
        const index = messages.findIndex((message) => message.id === prompt.messageID)
        const answered = index !== -1 && messages.slice(index + 1).some(isAssistant)
        if (!answered) setState(sessionID, "stalled", prompt)
      }, STALL_MS),
    )
  }

  async function retry(sessionID: string) {
    const stalled = state[sessionID]?.stalled
    if (!stalled) return
    await send(sessionID, stalled.text, { files: stalled.files })
  }

  function applyRequest(sessionID: string, event: DaemonEvent) {
    const data = event.data as Record<string, unknown>
    const id = (data.requestID ?? data.id) as string | undefined
    if (!id) return
    if (event.type === "question.v2.asked") {
      if (!state[sessionID].questions.some((item) => item.id === id))
        setState(sessionID, "questions", (list) => [...list, data as unknown as QuestionRequest])
      return
    }
    if (event.type === "permission.v2.asked") {
      if (!state[sessionID].permissions.some((item) => item.id === id))
        setState(sessionID, "permissions", (list) => [...list, data as unknown as PermissionRequest])
      return
    }
    // replied / rejected, answered here or in another client
    if (event.type.startsWith("question.v2."))
      setState(sessionID, "questions", (list) => list.filter((item) => item.id !== id))
    else setState(sessionID, "permissions", (list) => list.filter((item) => item.id !== id))
  }

  // Optimistically clear a request once answered; the replied event confirms it.
  function settle(sessionID: string, kind: "questions" | "permissions", id: string) {
    if (kind === "questions") setState(sessionID, "questions", (list) => list.filter((item) => item.id !== id))
    else setState(sessionID, "permissions", (list) => list.filter((item) => item.id !== id))
  }

  // Drop everything held for a session that no longer exists.
  function forget(sessionID: string) {
    queued.delete(sessionID)
    clearTimeout(watchers.get(sessionID))
    watchers.delete(sessionID)
    setState(
      produce((all) => {
        delete all[sessionID]
      }),
    )
  }

  return { state, load, apply, send, retry, settle, forget }
}

// Busy: the daemon reports a run in progress, or a prompt from here hasn't landed yet.
export function isBusy(conversation: Conversation | undefined, running: boolean) {
  return running || (conversation?.pending.length ?? 0) > 0
}

function reduce(messages: Message[], kind: string, data: DaemonEvent["data"]) {
  const d = data as Record<string, any>
  const at = typeof d.timestamp === "number" ? d.timestamp : Date.now()
  const assistant = () =>
    messages.filter(isAssistant).find((message) => message.id === d.assistantMessageID)
  const part = <T extends Part>(type: T["type"], id: string) =>
    assistant()?.content.find((item): item is T => item.type === type && item.id === id)

  switch (kind) {
    case "prompted": {
      if (messages.some((message) => message.id === d.messageID)) return
      messages.push({ type: "user", id: d.messageID, text: d.prompt?.text ?? "", files: d.prompt?.files, time: { created: at } })
      return
    }
    case "step.started": {
      for (const message of messages.filter(isAssistant))
        if (message.id !== d.assistantMessageID && !message.time.completed) message.time.completed = at
      if (assistant()) return
      messages.push({ type: "assistant", id: d.assistantMessageID, agent: d.agent, model: d.model, content: [], time: { created: at } })
      return
    }
    case "step.ended": {
      const message = assistant()
      if (!message) return
      message.time.completed = at
      message.finish = d.finish
      message.tokens = d.tokens
      return
    }
    case "step.failed": {
      const message = assistant()
      if (!message) return
      message.time.completed = at
      message.finish = "error"
      message.error = d.error
      return
    }
    case "text.started":
      if (!part<TextPart>("text", d.textID)) assistant()?.content.push({ type: "text", id: d.textID, text: "" })
      return
    case "text.delta": {
      const item = part<TextPart>("text", d.textID)
      if (item) item.text += d.delta
      return
    }
    case "text.ended": {
      const item = part<TextPart>("text", d.textID)
      if (item) item.text = d.text
      return
    }
    case "reasoning.started":
      if (!part<ReasoningPart>("reasoning", d.reasoningID))
        assistant()?.content.push({ type: "reasoning", id: d.reasoningID, text: "", time: { created: at } })
      return
    case "reasoning.delta": {
      const item = part<ReasoningPart>("reasoning", d.reasoningID)
      if (item) item.text += d.delta
      return
    }
    case "reasoning.ended": {
      const item = part<ReasoningPart>("reasoning", d.reasoningID)
      if (!item) return
      item.text = d.text
      item.time = { created: item.time?.created ?? at, completed: at }
      return
    }
    case "tool.input.started":
      if (!part<ToolPart>("tool", d.callID))
        assistant()?.content.push({ type: "tool", id: d.callID, name: d.name, state: { status: "pending" }, time: { created: at } })
      return
    case "tool.called": {
      const item = part<ToolPart>("tool", d.callID)
      if (!item) return
      item.name = d.tool ?? item.name
      item.state = { status: "running", input: d.input, structured: {}, content: [] }
      item.time = { ...item.time, ran: at }
      return
    }
    case "tool.progress": {
      const item = part<ToolPart>("tool", d.callID)
      if (!item || item.state.status !== "running") return
      item.state.structured = d.structured
      item.state.content = d.content
      return
    }
    case "tool.success": {
      const item = part<ToolPart>("tool", d.callID)
      if (!item) return
      item.state = { status: "completed", input: item.state.input, structured: d.structured, content: d.content }
      item.time = { ...item.time, completed: at }
      return
    }
    case "tool.failed": {
      const item = part<ToolPart>("tool", d.callID)
      if (!item) return
      item.state = { status: "error", input: item.state.input, error: d.error, content: [] }
      item.time = { ...item.time, completed: at }
      return
    }
  }
}
