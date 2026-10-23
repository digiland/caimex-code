import { createSignal } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { hermes, HermesError, isTerminal, parseEvent, parseQuestion, runEvents, type AgentTarget, type HermesEvent } from "./hermes"

// The Work tab: Hermes agents, one conversation each. Mirrors the mobile apps'
// AgentViewModel/AgentStore so a run behaves the same on every client: a dropped stream
// resumes after the last event applied, a server that can't replay is followed through
// the run's status, and approvals and questions survive a restart.

export type ApprovalPolicy = "ask" | "session" | "always"

export type AgentProfile = {
  id: string
  name: string
  baseURL: string
  // A multiplexed Hermes profile: requests go to /p/<profile>/…
  profile?: string
  emoji: string
  color: string
  instructions?: string
  // Answered app-side with the strongest grant a prompt offers; questions always wait.
  approvalPolicy: ApprovalPolicy
  pinned?: boolean
  createdAt: number
}

export type AgentItem = { id: string; time: number } & (
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; name: string; preview: string; running: boolean; error: boolean; duration?: number }
  | {
      kind: "approval"
      requestID?: string
      tool?: string
      command?: string
      choices: string[]
      reason?: string
      // once | session | always | deny | expired | elsewhere
      resolved?: string
      expiresAt?: number
    }
  | {
      kind: "question"
      clarifyID: string
      question: string
      choices: string[]
      multiSelect: boolean
      answer?: string
      expiresAt?: number
    }
  | { kind: "steer"; text: string }
  | { kind: "status"; text: string }
)

export type Queued = { id: string; text: string }

export type Thread = {
  sessionID?: string
  items: AgentItem[]
  runID?: string
  // Last event seq applied from that run: a reconnect replays only what came after.
  lastSeq: number
  // The bubble the run is streaming into, so replayed deltas continue it.
  streamingID?: string
  queued: Queued[]
  // The run failed or was stopped: the queue waits for an explicit send.
  queueHeld: boolean
  updated: number
}

export type Presence = "idle" | "working" | "needsYou"
export type Link = "live" | "reconnecting" | "polling"

type Live = {
  running: boolean
  link: Link
  // The approval or question the run is parked on (an item id).
  pending?: string
  error?: string
  presence: Presence
  unread: number
}

const PROFILES_KEY = "caimex.agents"
const threadKey = (id: string) => `caimex.agent-thread.${id}`
// Old history is dropped past this; the server keeps the session regardless.
const MAX_ITEMS = 600

const PALETTE = ["#14E0A1", "#7FD6FF", "#A855F7", "#EC4899", "#FF9F0A", "#30D158", "#5B8DEF", "#F87171"]
const EMOJIS = ["🤖", "☤", "🦾", "🧠", "📰", "🛠️", "🔎", "📈", "🎧", "🧪"]
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or unavailable: the run still works, it just won't survive a restart
  }
}

const emptyThread = (): Thread => ({ items: [], lastSeq: 0, queued: [], queueHeld: false, updated: Date.now() })

export const newProfile = (input: Partial<AgentProfile> & { name: string; baseURL: string }): AgentProfile => ({
  id: crypto.randomUUID(),
  emoji: pick(EMOJIS),
  color: pick(PALETTE),
  approvalPolicy: "ask",
  createdAt: Date.now(),
  ...input,
})

const uid = () => crypto.randomUUID()
const trimmed = (text: string) => text.trim()

// Hermes' API server assumes a plain-text client; tell it this one renders Markdown.
function instructions(profile: AgentProfile) {
  const base =
    "You are talking to a desktop client that renders Markdown: use headings, bullet lists, tables and fenced code blocks (with a language tag) when they make the answer clearer."
  const extra = profile.instructions?.trim()
  return extra ? `${base}\n\n${extra}` : base
}

export function preview(thread: Thread | undefined) {
  for (const item of [...(thread?.items ?? [])].reverse()) {
    if (item.kind === "user") return `You: ${item.text}`
    if (item.kind === "assistant" || item.kind === "status") return item.text
    if (item.kind === "tool") return `Ran ${item.name}`
  }
  return undefined
}

export type Agents = ReturnType<typeof createAgents>

export function createAgents() {
  const profiles = read<AgentProfile[]>(PROFILES_KEY) ?? []
  const [state, setState] = createStore<{
    profiles: AgentProfile[]
    threads: Record<string, Thread>
    live: Record<string, Live>
  }>({
    profiles,
    threads: Object.fromEntries(profiles.map((profile) => [profile.id, read<Thread>(threadKey(profile.id)) ?? emptyThread()])),
    live: Object.fromEntries(
      profiles.map((profile) => [profile.id, { running: false, link: "live", presence: "idle", unread: 0 } as Live]),
    ),
  })
  // Which agent is on screen: replies elsewhere count as unread.
  const [visible, setVisible] = createSignal<string>()

  // Per-agent run plumbing that isn't state: the follow loop's abort and the raw text of
  // the bubble being streamed (to recognise Hermes' echo of it).
  const runtime = new Map<string, { abort?: AbortController; buffer: string; delivered: boolean }>()
  const rt = (id: string) => {
    let value = runtime.get(id)
    if (!value) runtime.set(id, (value = { buffer: "", delivered: false }))
    return value
  }

  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const save = (id: string) => {
    clearTimeout(saveTimers.get(id))
    saveTimers.set(
      id,
      setTimeout(() => {
        const thread = unwrap(state.threads[id])
        if (thread) write(threadKey(id), { ...thread, items: thread.items.slice(-MAX_ITEMS) })
      }, 300),
    )
  }
  const saveProfiles = () => write(PROFILES_KEY, unwrap(state.profiles))

  const profileOf = (id: string) => state.profiles.find((profile) => profile.id === id)
  const target = (id: string): AgentTarget | undefined => {
    const profile = profileOf(id)
    return profile && { id: profile.id, baseURL: profile.baseURL, profile: profile.profile || undefined }
  }

  const mutate = (id: string, fn: (thread: Thread) => void) => {
    setState(
      "threads",
      id,
      produce((thread) => {
        fn(thread)
        thread.updated = Date.now()
      }),
    )
    save(id)
  }
  const setLive = (id: string, patch: Partial<Live>) => setState("live", id, patch)
  const presence = (id: string, value: Presence) => setLive(id, { presence: value })

  // ---- event reducer -------------------------------------------------------------

  function openDecision(thread: Thread) {
    return thread.items.findLast(
      (item) => (item.kind === "approval" && !item.resolved) || (item.kind === "question" && item.answer === undefined),
    )
  }

  function apply(id: string, event: HermesEvent) {
    const run = rt(id)
    if (!["started", "other", "completed"].includes(event.type)) run.delivered = true
    const profile = profileOf(id)
    let autoApprove: string | undefined
    // Live state changes wait until the thread mutation has finished.
    const after: (() => void)[] = []
    const later = (fn: () => void) => void after.push(fn)

    mutate(id, (thread) => {
      const streaming = () => thread.items.find((item) => item.id === thread.streamingID)
      switch (event.type) {
        case "started":
        case "other":
          return
        case "delta": {
          if (!event.text) return
          const current = streaming()
          if (current?.kind === "assistant") {
            run.buffer += event.text
            current.text += event.text
          } else if (current?.kind === "reasoning") {
            // The echo already carried this text; swallow late deltas it covers.
            run.buffer += event.text
            if (!current.text.startsWith(trimmed(run.buffer))) current.text += event.text
          } else {
            const item: AgentItem = { id: uid(), time: Date.now(), kind: "assistant", text: event.text }
            thread.items.push(item)
            thread.streamingID = item.id
            run.buffer = event.text
          }
          return
        }
        case "reasoning": {
          // Hermes re-emits every assistant message as reasoning.available, sometimes
          // before the last deltas land. Fold it into the streaming bubble as narration;
          // run.completed turns the final answer back into a bubble.
          const clean = trimmed(event.text)
          if (!clean) return
          const streamed = trimmed(run.buffer)
          const current = streaming()
          if (current && (current.kind === "assistant" || current.kind === "reasoning") && (clean.startsWith(streamed) || streamed.startsWith(clean))) {
            Object.assign(current, { kind: "reasoning", text: clean })
            return
          }
          const recent = thread.items
            .slice(-4)
            .some((item) => (item.kind === "assistant" || item.kind === "reasoning") && trimmed(item.text) === clean)
          if (!recent) thread.items.push({ id: uid(), time: Date.now(), kind: "reasoning", text: clean })
          return
        }
        case "tool.started": {
          // Text streamed right before a tool call is the agent narrating its plan.
          const current = streaming()
          if (current?.kind === "assistant") Object.assign(current, { kind: "reasoning", text: trimmed(current.text) })
          thread.streamingID = undefined
          run.buffer = ""
          thread.items.push({
            id: uid(),
            time: Date.now(),
            kind: "tool",
            name: event.tool,
            preview: event.preview,
            running: true,
            error: false,
          })
          return
        }
        case "tool.completed": {
          const tool = thread.items.findLast((item) => item.kind === "tool" && item.running && item.name === event.tool)
          if (tool?.kind === "tool") Object.assign(tool, { running: false, error: event.error, duration: event.duration })
          return
        }
        case "approval": {
          thread.streamingID = undefined
          // The same prompt arrives twice (replayed stream and run status): one card per id.
          const existing = event.id
            ? thread.items.findLast((item) => item.kind === "approval" && item.requestID === event.id)
            : undefined
          if (existing?.kind === "approval") {
            if (!existing.resolved) {
              later(() => setLive(id, { pending: existing.id }))
              later(() => presence(id, "needsYou"))
            }
            return
          }
          const item: AgentItem = {
            id: uid(),
            time: Date.now(),
            kind: "approval",
            requestID: event.id,
            tool: event.tool,
            command: event.command,
            choices: event.choices,
            reason: event.reason,
            expiresAt: event.expiresAt,
          }
          thread.items.push(item)
          later(() => setLive(id, { pending: item.id }))
          const policy = profile?.approvalPolicy ?? "ask"
          autoApprove = policy === "ask" ? undefined : [policy, "session", "once"].find((choice) => event.choices.includes(choice))
          if (!autoApprove) later(() => presence(id, "needsYou"))
          return
        }
        case "question": {
          thread.streamingID = undefined
          const existing = thread.items.findLast((item) => item.kind === "question" && item.clarifyID === event.id)
          if (existing?.kind === "question") {
            if (existing.answer === undefined) {
              later(() => setLive(id, { pending: existing.id }))
              later(() => presence(id, "needsYou"))
            }
            return
          }
          const item: AgentItem = {
            id: uid(),
            time: Date.now(),
            kind: "question",
            clarifyID: event.id,
            question: event.question,
            choices: event.choices,
            multiSelect: event.multiSelect,
            expiresAt: event.expiresAt,
          }
          thread.items.push(item)
          later(() => setLive(id, { pending: item.id }))
          later(() => presence(id, "needsYou"))
          return
        }
        case "question.responded": {
          const question = thread.items.findLast(
            (item) => item.kind === "question" && item.answer === undefined && (!event.id || item.clarifyID === event.id),
          )
          if (question?.kind === "question") {
            question.answer = event.timedOut ? "(no answer)" : (event.answer ?? "answered")
            const answered = question.id
            later(() => {
              if (state.live[id]?.pending === answered) setLive(id, { pending: undefined })
            })
          }
          later(() => {
            if (!state.live[id]?.pending) presence(id, "working")
          })
          return
        }
        case "approval.responded": {
          resolveApproval(thread, id, event.choice ?? "resolved", later)
          return
        }
        case "completed": {
          const final = trimmed(event.output ?? "")
          const current = streaming()
          // The answer's echo folded the streaming bubble into narration; promote it back.
          if (final && current?.kind === "reasoning" && (current.text === final || final.startsWith(current.text) || current.text.startsWith(final)))
            Object.assign(current, { kind: "assistant", text: final })
          else {
            const last = thread.items.at(-1)
            if (final && last?.kind === "reasoning" && last.text === final) Object.assign(last, { kind: "assistant" })
          }
          if (final) {
            const shown = thread.items.findLast((item) => item.kind === "assistant")
            const text = shown?.kind === "assistant" ? trimmed(shown.text) : ""
            const alreadyShown = !!text && (text === final || text.endsWith(final) || final.endsWith(text))
            if (!alreadyShown) {
              thread.items.push({ id: uid(), time: Date.now(), kind: "assistant", text: final })
              run.delivered = true
            }
          }
          thread.streamingID = undefined
          run.buffer = ""
          return
        }
        case "failed":
          later(() => setLive(id, { error: event.message }))
          thread.items.push({ id: uid(), time: Date.now(), kind: "status", text: `Run failed: ${event.message}` })
          return
        case "cancelled":
          thread.items.push({ id: uid(), time: Date.now(), kind: "status", text: "Stopped" })
          return
      }
    })
    for (const fn of after) fn()
    if (autoApprove) void approve(id, autoApprove)
  }

  function resolveApproval(thread: Thread, id: string, choice: string, later: (fn: () => void) => void) {
    const pending = state.live[id]?.pending
    const item =
      thread.items.find((entry) => entry.id === pending && entry.kind === "approval") ??
      thread.items.findLast((entry) => entry.kind === "approval" && !entry.resolved)
    if (item?.kind === "approval") item.resolved = choice
    later(() => {
      if (item && pending === item.id) setLive(id, { pending: undefined })
      if (!state.live[id]?.pending && state.live[id]?.running) presence(id, "working")
    })
  }

  // Close the card on screen without an answer from here (answered elsewhere, or expired).
  function resolvePending(id: string, approval: string, answer: string) {
    const pending = state.live[id]?.pending
    if (!pending) return
    mutate(id, (thread) => {
      const item = thread.items.find((entry) => entry.id === pending)
      if (item?.kind === "approval" && !item.resolved) item.resolved = approval
      if (item?.kind === "question" && item.answer === undefined) item.answer = answer
    })
    setLive(id, { pending: undefined })
    if (state.live[id]?.running) presence(id, "working")
  }

  // Decisions the server no longer holds (the run is gone).
  function expireOpenDecisions(id: string) {
    mutate(id, (thread) => {
      for (const item of thread.items) {
        if (item.kind === "approval" && !item.resolved) item.resolved = "expired"
        if (item.kind === "question" && item.answer === undefined) item.answer = "(expired)"
      }
    })
    setLive(id, { pending: undefined })
  }

  function closeRunningTools(id: string) {
    mutate(id, (thread) => {
      for (const item of thread.items) if (item.kind === "tool" && item.running) item.running = false
    })
  }

  // ---- following a run -----------------------------------------------------------

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true })
    })

  async function streamOnce(id: string, runID: string, signal: AbortSignal) {
    const where = target(id)
    if (!where) return { outcome: "dropped" as const, received: false }
    let received = false
    try {
      for await (const item of runEvents(where, runID, state.threads[id].lastSeq, signal)) {
        received = true
        setLive(id, { link: "live" })
        if (item.seq !== undefined) {
          if (item.seq <= state.threads[id].lastSeq) continue // already applied
          mutate(id, (thread) => void (thread.lastSeq = item.seq!))
        }
        apply(id, item.event)
        if (isTerminal(item.event)) return { outcome: "settled" as const, received }
      }
      return { outcome: "dropped" as const, received }
    } catch (error) {
      return { outcome: error instanceof HermesError && error.status === 404 ? ("unavailable" as const) : ("dropped" as const), received }
    }
  }

  // Bring the timeline in line with the run's status: surface a parked decision (even
  // one asked while this app was closed), clear one answered elsewhere, or fold in the
  // outcome of a run that finished.
  async function reconcile(id: string, runID: string): Promise<"settled" | "live" | "unreachable"> {
    const where = target(id)
    if (!where) return "settled"
    let status
    try {
      status = await hermes.status(where, runID)
    } catch (error) {
      if (error instanceof HermesError && error.status === 404) {
        expireOpenDecisions(id)
        return "settled"
      }
      return "unreachable"
    }
    switch (status.status) {
      case "waiting_for_approval":
        if (status.approval) apply(id, parseEvent(status.approval))
        return "live"
      case "waiting_for_clarify": {
        const question = status.clarify && parseQuestion(status.clarify)
        if (question) apply(id, question)
        return "live"
      }
      case "queued":
      case "started":
      case "running":
      case "stopping":
        // Not parked, so a card still showing was answered on another device.
        if (state.live[id]?.pending) resolvePending(id, "elsewhere", "(answered elsewhere)")
        return "live"
      case "completed":
        apply(id, { type: "completed", output: status.output })
        return "settled"
      case "failed":
        apply(id, { type: "failed", message: hermes.errorText(status.error) ?? "Run failed" })
        return "settled"
      case "cancelled":
      case "interrupted":
        apply(id, { type: "cancelled" })
        return "settled"
      default:
        expireOpenDecisions(id)
        return "settled"
    }
  }

  function follow(id: string, runID: string) {
    const run = rt(id)
    run.abort?.abort()
    const abort = new AbortController()
    run.abort = abort
    run.delivered = false
    void (async () => {
      let failures = 0
      while (!abort.signal.aborted) {
        const { outcome, received } = await streamOnce(id, runID, abort.signal)
        if (abort.signal.aborted) return
        if (outcome === "settled") return settled(id)
        failures = received ? 0 : failures + 1
        if (outcome === "unavailable" || failures >= 3) {
          const result = await reconcile(id, runID)
          if (abort.signal.aborted) return
          if (result === "settled") return settled(id)
          if (result === "live" && outcome === "unavailable") {
            setLive(id, { link: "polling" })
            failures = 0
          } else if (result === "unreachable") setLive(id, { link: "reconnecting" })
        } else setLive(id, { link: "reconnecting" })
        const delay = state.live[id]?.link === "polling" ? 4000 : Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1))
        await sleep(delay, abort.signal)
      }
    })()
  }

  // The run is over: clear live state, count it unread if nobody watched, then send any
  // queued follow-ups.
  function settled(id: string) {
    const run = rt(id)
    const thread = state.threads[id]
    const last = thread.items.at(-1)
    const failedOrStopped = last?.kind === "status" && (last.text === "Stopped" || last.text.startsWith("Run failed"))
    run.buffer = ""
    run.abort = undefined
    mutate(id, (draft) => {
      draft.runID = undefined
      draft.lastSeq = 0
      draft.streamingID = undefined
    })
    closeRunningTools(id)
    setLive(id, {
      running: false,
      pending: undefined,
      link: "live",
      presence: "idle",
      unread: run.delivered && visible() !== id ? (state.live[id]?.unread ?? 0) + 1 : (state.live[id]?.unread ?? 0),
    })
    run.delivered = false
    if (!state.threads[id].queued.length) return
    if (failedOrStopped) mutate(id, (draft) => void (draft.queueHeld = true))
    else if (!state.threads[id].queueHeld) void flushQueue(id)
  }

  async function startRun(id: string, texts: string[]) {
    const profile = profileOf(id)
    const where = target(id)
    if (!profile || !where) return false
    const users: AgentItem[] = texts.map((text) => ({ id: uid(), time: Date.now(), kind: "user", text }))
    mutate(id, (thread) => void thread.items.push(...users))
    setLive(id, { running: true, presence: "working", error: undefined })
    try {
      const runID = await hermes.startRun(where, texts.join("\n\n"), state.threads[id].sessionID, instructions(profile))
      mutate(id, (thread) => {
        thread.runID = runID
        thread.lastSeq = 0
        // The first run's id doubles as the session id.
        thread.sessionID ??= runID
      })
      follow(id, runID)
      return true
    } catch (error) {
      const ids = new Set(users.map((item) => item.id))
      mutate(id, (thread) => void (thread.items = thread.items.filter((item) => !ids.has(item.id))))
      setLive(id, { running: false, presence: "idle", error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  async function flushQueue(id: string) {
    const batch = [...state.threads[id].queued]
    if (!batch.length) return
    mutate(id, (thread) => {
      thread.queued = []
      thread.queueHeld = false
    })
    if (!(await startRun(id, batch.map((item) => item.text))))
      // Never lose what was typed: put it back, held for an explicit send.
      mutate(id, (thread) => {
        thread.queued = [...batch, ...thread.queued]
        thread.queueHeld = true
      })
  }

  // ---- actions -------------------------------------------------------------------

  // Sends now, or queues while a run is going; the queue goes out as the next turn.
  async function send(id: string, text: string) {
    const value = text.trim()
    if (!value) return
    setLive(id, { error: undefined })
    if (state.live[id]?.running) {
      mutate(id, (thread) => void thread.queued.push({ id: uid(), text: value }))
      return
    }
    if (!(await startRun(id, [value]))) throw new Error(state.live[id]?.error ?? "Couldn't start the run.")
  }

  // Put a message into the running agent right away (Hermes "steer").
  async function steer(id: string, text: string) {
    const runID = state.threads[id]?.runID
    const where = target(id)
    if (!state.live[id]?.running || !runID || !where) return send(id, text)
    await hermes.steer(where, runID, text)
    mutate(id, (thread) => void thread.items.push({ id: uid(), time: Date.now(), kind: "steer", text }))
  }

  async function steerQueued(id: string, queuedID: string) {
    const item = state.threads[id].queued.find((entry) => entry.id === queuedID)
    if (!item) return
    removeQueued(id, queuedID)
    await steer(id, item.text)
  }

  function removeQueued(id: string, queuedID: string) {
    mutate(id, (thread) => {
      thread.queued = thread.queued.filter((entry) => entry.id !== queuedID)
      if (!thread.queued.length) thread.queueHeld = false
    })
  }

  async function sendQueued(id: string) {
    if (state.live[id]?.running) return
    await flushQueue(id)
  }

  async function approve(id: string, choice: string) {
    const runID = state.threads[id]?.runID
    const where = target(id)
    const item = state.threads[id]?.items.find((entry) => entry.id === state.live[id]?.pending)
    if (!runID || !where || item?.kind !== "approval") return
    try {
      await hermes.approve(where, runID, choice, item.requestID)
      const after: (() => void)[] = []
      mutate(id, (thread) => resolveApproval(thread, id, choice, (fn) => void after.push(fn)))
      for (const fn of after) fn()
    } catch (error) {
      // 409: no longer pending, answered on another device or timed out (which denies).
      if (error instanceof HermesError && error.status === 409)
        resolvePending(id, item.expiresAt && item.expiresAt * 1000 < Date.now() ? "expired" : "elsewhere", "")
      else throw error
    }
  }

  async function answer(id: string, text: string) {
    const runID = state.threads[id]?.runID
    const where = target(id)
    const item = state.threads[id]?.items.find((entry) => entry.id === state.live[id]?.pending)
    if (!runID || !where || item?.kind !== "question") return
    try {
      await hermes.answer(where, runID, item.clarifyID, text)
      mutate(id, (thread) => {
        const question = thread.items.find((entry) => entry.id === item.id)
        if (question?.kind === "question") question.answer = text
      })
      setLive(id, { pending: undefined, presence: "working" })
    } catch (error) {
      if (error instanceof HermesError && error.status === 409)
        resolvePending(
          id,
          "elsewhere",
          item.expiresAt && item.expiresAt * 1000 < Date.now() ? "(expired)" : "(answered elsewhere)",
        )
      else throw error
    }
  }

  async function stop(id: string) {
    const runID = state.threads[id]?.runID
    const where = target(id)
    if (runID && where) await hermes.stop(where, runID)
  }

  function newConversation(id: string) {
    rt(id).abort?.abort()
    runtime.delete(id)
    setState("threads", id, emptyThread())
    save(id)
    setLive(id, { running: false, link: "live", pending: undefined, error: undefined, presence: "idle" })
  }

  function resume(id: string) {
    const thread = state.threads[id]
    const current = thread?.items.find((item) => item.id === thread.streamingID)
    rt(id).buffer = current && (current.kind === "assistant" || current.kind === "reasoning") ? current.text : ""
    closeRunningTools(id)
    if (!thread?.runID) return expireOpenDecisions(id)
    setLive(id, { running: true })
    // A decision asked before the app closed is already in the timeline; replay only
    // sends newer events, so restore it here (a replayed answer clears it).
    const open = openDecision(thread)
    setLive(id, { pending: open?.id, presence: open ? "needsYou" : "working" })
    follow(id, thread.runID)
  }

  // ---- profiles ------------------------------------------------------------------

  function add(profile: AgentProfile) {
    setState("profiles", (list) => [...list, profile])
    setState("threads", profile.id, emptyThread())
    setState("live", profile.id, { running: false, link: "live", presence: "idle", unread: 0 })
    saveProfiles()
  }

  function update(profile: AgentProfile) {
    setState("profiles", (list) => list.map((item) => (item.id === profile.id ? profile : item)))
    saveProfiles()
  }

  async function remove(id: string) {
    rt(id).abort?.abort()
    runtime.delete(id)
    setState("profiles", (list) => list.filter((item) => item.id !== id))
    saveProfiles()
    write(threadKey(id), undefined)
    await window.caimex.hermes.setKey(id, undefined)
  }

  function markRead(id: string) {
    setVisible(id)
    if (state.live[id]?.unread) setLive(id, { unread: 0 })
  }

  // Needs-you first, then pinned, then most recent.
  const sorted = () =>
    [...state.profiles].sort((a, b) => {
      const na = state.live[a.id]?.presence === "needsYou"
      const nb = state.live[b.id]?.presence === "needsYou"
      if (na !== nb) return na ? -1 : 1
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (state.threads[b.id]?.updated ?? b.createdAt) - (state.threads[a.id]?.updated ?? a.createdAt)
    })

  for (const profile of profiles) resume(profile.id)

  return {
    state,
    sorted,
    profileOf,
    target,
    visible,
    setVisible,
    markRead,
    add,
    update,
    remove,
    send,
    steer,
    steerQueued,
    removeQueued,
    sendQueued,
    approve,
    answer,
    stop,
    newConversation,
    // Re-attach every agent with a run in flight (after sleep or a network change).
    resumeAll: () => {
      for (const profile of state.profiles) if (state.threads[profile.id]?.runID) follow(profile.id, state.threads[profile.id].runID!)
    },
  }
}
