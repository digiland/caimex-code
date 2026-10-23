// Hermes Agent's API server (gateway/platforms/api_server.py), reached through the main
// process. The run protocol is shared with the mobile apps; see
// caimex-mobile/PROTOCOL.md ("Hermes agents") for the contract this follows.

export type AgentTarget = { id: string; baseURL: string; profile?: string }

export type HermesBridge = {
  local(): Promise<{ found: false } | { found: true; baseURL: string; profiles: string[]; hasKey: boolean }>
  hasKey(id: string): Promise<boolean>
  setKey(id: string, key: string | undefined): Promise<void>
  useLocalKey(id: string): Promise<boolean>
  request(target: AgentTarget, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }>
  // Undefined when the agent isn't on this Mac (or the job has no runs yet).
  jobOutputs(target: AgentTarget, jobID: string): Promise<{ name: string; time: number }[] | undefined>
  jobOutput(target: AgentTarget, jobID: string, name: string): Promise<string | undefined>
  stream(streamID: string, target: AgentTarget, path: string): void
  cancel(streamID: string): void
  onEvent(listener: (payload: { streamID: string; data: Record<string, unknown> }) => void): () => void
  onEnd(listener: (payload: { streamID: string; status: number; error?: string }) => void): () => void
}

export type HermesEvent =
  | { type: "started" }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool.started"; tool: string; preview: string }
  | { type: "tool.completed"; tool: string; duration?: number; error: boolean }
  | {
      type: "approval"
      id?: string
      tool?: string
      command?: string
      choices: string[]
      reason?: string
      expiresAt?: number
    }
  | { type: "approval.responded"; choice?: string }
  | { type: "question"; id: string; question: string; choices: string[]; multiSelect: boolean; expiresAt?: number }
  | { type: "question.responded"; id?: string; answer?: string; timedOut: boolean }
  | { type: "completed"; output?: string }
  | { type: "failed"; message: string }
  | { type: "cancelled" }
  | { type: "other" }

export const isTerminal = (event: HermesEvent) =>
  event.type === "completed" || event.type === "failed" || event.type === "cancelled"

const str = (value: unknown) => (typeof value === "string" ? value : undefined)
const num = (value: unknown) => (typeof value === "number" ? value : undefined)
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : [])

function errorText(value: unknown) {
  return str(value) ?? str((value as { message?: unknown } | undefined)?.message)
}

// A question parked on the run, as the status carries it (`status.clarify`).
export function parseQuestion(object: Record<string, unknown>): HermesEvent | undefined {
  const id = str(object.clarify_id)
  if (!id) return undefined
  return {
    type: "question",
    id,
    question: str(object.question) ?? "",
    choices: strings(object.choices),
    multiSelect: object.multi_select === true,
    expiresAt: num(object.expires_at),
  }
}

export function parseEvent(object: Record<string, unknown>): HermesEvent {
  switch (object.event) {
    case "run.started":
      return { type: "started" }
    case "message.delta":
      return { type: "delta", text: str(object.delta) ?? "" }
    case "reasoning.available":
      return { type: "reasoning", text: str(object.text) ?? "" }
    case "tool.started":
      return { type: "tool.started", tool: str(object.tool) ?? "tool", preview: str(object.preview) ?? "" }
    case "tool.completed":
      return { type: "tool.completed", tool: str(object.tool) ?? "tool", duration: num(object.duration), error: object.error === true }
    case "approval.request":
      return {
        type: "approval",
        id: str(object.request_id) ?? str(object.approval_id),
        tool: str(object.tool),
        command: str(object.command) ?? str(object.preview),
        choices: object.choices ? strings(object.choices) : ["once", "deny"],
        reason: str(object.reason) ?? str(object.description) ?? str(object.message),
        expiresAt: num(object.expires_at),
      }
    case "approval.responded":
      return { type: "approval.responded", choice: str(object.choice) }
    case "clarify.request":
      return parseQuestion(object) ?? { type: "other" }
    case "clarify.responded":
      return {
        type: "question.responded",
        id: str(object.clarify_id),
        answer: str(object.answer),
        timedOut: object.timed_out === true,
      }
    case "run.completed":
      return { type: "completed", output: str(object.output) }
    case "run.failed":
      return { type: "failed", message: errorText(object.error) ?? "Run failed" }
    case "run.interrupted":
      return { type: "failed", message: "The agent's gateway restarted during this run." }
    case "run.cancelled":
      return { type: "cancelled" }
    default:
      return { type: "other" }
  }
}

export class HermesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const bridge = () => window.caimex.hermes

async function call<T>(target: AgentTarget, method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await bridge().request(target, method, path, body)
  if (status >= 200 && status < 300) return data as T
  const detail = (data as { error?: { message?: string } | string; detail?: string } | undefined) ?? {}
  const message =
    (typeof detail.error === "string" ? detail.error : detail.error?.message) ??
    detail.detail ??
    (status === 0 ? "Couldn't reach the agent." : `The agent returned HTTP ${status}.`)
  throw new HermesError(status, message)
}

// One stream at a time per call; yields events until the server closes it. A 404 means
// the server can't replay this run, and throws so the caller can follow by status.
export async function* runEvents(target: AgentTarget, runID: string, after: number, signal: AbortSignal) {
  const streamID = crypto.randomUUID()
  const queue: { seq?: number; event: HermesEvent }[] = []
  let ended: { status: number; error?: string } | undefined
  let wake: (() => void) | undefined
  const offEvent = bridge().onEvent((payload) => {
    if (payload.streamID !== streamID) return
    queue.push({ seq: num(payload.data.seq), event: parseEvent(payload.data) })
    wake?.()
  })
  const offEnd = bridge().onEnd((payload) => {
    if (payload.streamID !== streamID) return
    ended = payload
    wake?.()
  })
  const onAbort = () => bridge().cancel(streamID)
  signal.addEventListener("abort", onAbort)
  try {
    bridge().stream(streamID, target, `v1/runs/${encodeURIComponent(runID)}/events${after > 0 ? `?after=${after}` : ""}`)
    while (!signal.aborted) {
      while (queue.length) yield queue.shift()!
      if (ended) {
        if (ended.status === 404) throw new HermesError(404, "This run can't be replayed.")
        if (ended.status !== 200) throw new HermesError(ended.status, ended.error ?? `Stream failed (HTTP ${ended.status}).`)
        return
      }
      await new Promise<void>((resolve) => (wake = resolve))
      wake = undefined
    }
  } finally {
    signal.removeEventListener("abort", onAbort)
    offEvent()
    offEnd()
    if (!ended) bridge().cancel(streamID)
  }
}

export type RunStatus = {
  status?: string
  approval?: Record<string, unknown>
  clarify?: Record<string, unknown>
  clarify_id?: string
  output?: string
  error?: unknown
}

// A scheduled job (Hermes cron, /api/jobs).
export type Job = {
  id: string
  name: string
  prompt: string
  schedule_display?: string
  schedule?: { kind?: string; expr?: string; display?: string }
  enabled?: boolean
  // scheduled | paused | running | completed | error
  state?: string
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string | null
  last_error?: string | null
  last_delivery_error?: string | null
  repeat?: { times?: number | null; completed?: number }
  // A script job runs a shell script with no model turn.
  no_agent?: boolean
  script?: string | null
  skills?: string[]
  deliver?: string
  created_at?: string
}

const jobPath = (id: string) => `api/jobs/${encodeURIComponent(id)}`

export const jobs = {
  list: async (target: AgentTarget) =>
    (await call<{ jobs?: Job[] }>(target, "GET", "api/jobs?include_disabled=true")).jobs ?? [],
  create: async (target: AgentTarget, input: { name: string; schedule: string; prompt: string }) =>
    (await call<{ job: Job }>(target, "POST", "api/jobs", { ...input, deliver: "local" })).job,
  update: async (target: AgentTarget, id: string, patch: Partial<Pick<Job, "name" | "prompt">> & { schedule?: string }) =>
    (await call<{ job: Job }>(target, "PATCH", jobPath(id), patch)).job,
  remove: (target: AgentTarget, id: string) => call(target, "DELETE", jobPath(id)),
  pause: async (target: AgentTarget, id: string) => (await call<{ job: Job }>(target, "POST", `${jobPath(id)}/pause`, {})).job,
  resume: async (target: AgentTarget, id: string) => (await call<{ job: Job }>(target, "POST", `${jobPath(id)}/resume`, {})).job,
  run: async (target: AgentTarget, id: string) => (await call<{ job: Job }>(target, "POST", `${jobPath(id)}/run`, {})).job,
}

export const hermes = {
  health: (target: AgentTarget) => call<{ status: string; platform?: string; version?: string }>(target, "GET", "health"),
  startRun: async (target: AgentTarget, input: string, sessionID?: string, instructions?: string) => {
    const result = await call<{ run_id?: string }>(target, "POST", "v1/runs", {
      input,
      ...(sessionID ? { session_id: sessionID } : {}),
      ...(instructions ? { instructions } : {}),
    })
    if (!result?.run_id) throw new HermesError(500, "The agent didn't return a run id.")
    return result.run_id
  },
  status: (target: AgentTarget, runID: string) => call<RunStatus>(target, "GET", `v1/runs/${encodeURIComponent(runID)}`),
  steer: (target: AgentTarget, runID: string, input: string) =>
    call(target, "POST", `v1/runs/${encodeURIComponent(runID)}/steer`, { input }),
  stop: (target: AgentTarget, runID: string) => call(target, "POST", `v1/runs/${encodeURIComponent(runID)}/stop`, {}),
  approve: (target: AgentTarget, runID: string, choice: string, requestID?: string) =>
    call(target, "POST", `v1/runs/${encodeURIComponent(runID)}/approval`, {
      choice,
      ...(requestID ? { request_id: requestID } : {}),
    }),
  answer: (target: AgentTarget, runID: string, clarifyID: string, answer: string) =>
    call(target, "POST", `v1/runs/${encodeURIComponent(runID)}/clarify`, { clarify_id: clarifyID, answer }),
  errorText,
}
