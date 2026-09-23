import { createMemo, createResource, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import { isAssistant, isUser, type Message, type PermissionReply, type Session, type UserMessage } from "../api"
import { isBusy, type Attachment, type Conversation } from "../conversations"
import { compact } from "../format"
import { Composer, type Draft, type Suggestion } from "./composer"
import { ConversationView } from "./conversation"
import { PermissionCard, QuestionCard } from "./requests"

export function SessionView(props: {
  session: Session
  title: string
  conversation: Conversation | undefined
  running: boolean
  controls: JSX.Element
  // The selected model's context window, when known.
  contextLimit: number | undefined
  // What the model currently sees, for the breakdown.
  loadContext: () => Promise<Message[]>
  draft: Draft | undefined
  paneOpen: boolean
  onTogglePane: () => void
  suggest: (kind: "mention" | "command", query: string) => Promise<Suggestion[]>
  userActions: (message: UserMessage, index: number) => JSX.Element
  onRetry: () => void
  onRetrySend: () => void
  onSend: (text: string, files: Attachment[]) => Promise<void>
  onStop: () => Promise<void>
  onAnswer: (requestID: string, answers: string[][]) => Promise<void>
  onDismiss: (requestID: string) => Promise<void>
  onDecide: (requestID: string, reply: PermissionReply) => Promise<void>
}) {
  const assistants = createMemo(() => props.conversation?.messages.filter(isAssistant) ?? [])
  // Each step re-sends the whole conversation, so the latest step's input plus what it
  // produced is the context size; summing inputs would count the history once per step.
  const context = () => {
    const tokens = assistants().findLast((message) => message.tokens)?.tokens
    return tokens ? tokens.input + tokens.output : undefined
  }

  return (
    <div class="flex h-full flex-col">
      <header class="drag flex h-[52px] shrink-0 items-center gap-4 border-b border-line px-6">
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13px] font-medium">{props.title}</div>
          <div class="truncate font-mono text-[10.5px] text-faint" title={props.session.location.directory}>
            {props.session.location.directory}
          </div>
        </div>
        <Show when={context()}>
          {(used) => <ContextMeter used={used()} limit={props.contextLimit} load={props.loadContext} />}
        </Show>
        <button
          onClick={props.onTogglePane}
          title="Files, changes and terminal (⌘\\)"
          classList={{ "bg-active text-text": props.paneOpen, "text-muted": !props.paneOpen }}
          class="no-drag flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-text"
        >
          <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.3">
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
            <path d="M10 2.5v11" />
          </svg>
        </button>
      </header>
      <Show when={props.conversation} fallback={<div class="flex-1" />}>
        {(conversation) => (
          <ConversationView
            conversation={conversation()}
            directory={props.session.location.directory}
            busy={isBusy(props.conversation, props.running)}
            onRetry={props.onRetry}
            onRetrySend={props.onRetrySend}
            userActions={props.userActions}
          />
        )}
      </Show>
      <Show when={props.conversation?.permissions.length || props.conversation?.questions.length}>
        <div class="shrink-0 px-8 pb-3">
          <div class="mx-auto flex max-w-[780px] flex-col gap-3">
            <For each={props.conversation?.permissions}>
              {(request) => <PermissionCard request={request} onDecide={(reply) => props.onDecide(request.id, reply)} />}
            </For>
            <For each={props.conversation?.questions}>
              {(request) => (
                <QuestionCard
                  request={request}
                  onAnswer={(answers) => props.onAnswer(request.id, answers)}
                  onDismiss={() => props.onDismiss(request.id)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
      <Composer
        busy={isBusy(props.conversation, props.running)}
        controls={props.controls}
        draft={props.draft}
        suggest={props.suggest}
        onSend={props.onSend}
        onStop={props.onStop}
      />
    </div>
  )
}

// How full the model's context window is. The daemon on dev can't compact on request,
// so this informs rather than offering an action; clicking it breaks the total down.
function ContextMeter(props: { used: number; limit: number | undefined; load: () => Promise<Message[]> }) {
  const [open, setOpen] = createSignal(false)
  const ratio = () => (props.limit ? Math.min(1, props.used / props.limit) : undefined)
  const tone = () => {
    const value = ratio() ?? 0
    return value > 0.95 ? "var(--bad)" : value > 0.85 ? "var(--warn)" : "var(--muted)"
  }
  const label = () =>
    props.limit
      ? `${compact(props.used)} of ${compact(props.limit)} tokens in context`
      : `${compact(props.used)} tokens in context`
  return (
    <div class="no-drag relative shrink-0">
      <button
        onClick={() => setOpen(!open())}
        title={`${label()}. Click for a breakdown.`}
        class="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-faint hover:bg-hover hover:text-text"
      >
        <Show when={ratio() !== undefined}>
          <svg viewBox="0 0 20 20" class="size-4 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" stroke-width="2.5" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke={tone()}
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-dasharray={`${(ratio() ?? 0) * 50.27} 50.27`}
            />
          </svg>
        </Show>
        <span>{ratio() !== undefined ? `${Math.round((ratio() ?? 0) * 100)}%` : compact(props.used)}</span>
      </button>
      <Show when={open()}>
        <ContextBreakdown used={props.used} limit={props.limit} load={props.load} onClose={() => setOpen(false)} />
      </Show>
    </div>
  )
}

type Slice = { label: string; tokens: number; color: string }

// Rough tokens from text size; only the proportions are used, scaled to the real total.
const estimate = (text: string) => Math.ceil(text.length / 4)

function breakdown(messages: Message[], used: number) {
  let yours = 0
  let replies = 0
  let thinking = 0
  let calls = 0
  let results = 0
  let images = 0
  const byTool = new Map<string, number>()
  for (const message of messages) {
    if (isUser(message)) {
      yours += estimate(message.text)
      // Providers bill an image at roughly this many tokens.
      images += ((message.files as unknown[] | undefined)?.length ?? 0) * 1_000
      continue
    }
    if (!isAssistant(message)) continue
    for (const part of message.content) {
      if (part.type === "text") replies += estimate(part.text)
      else if (part.type === "reasoning") thinking += estimate(part.text)
      else if (part.type === "tool") {
        calls += estimate(JSON.stringify(part.state.input ?? {}))
        const output = (part.state.content ?? []).map((item) => item.text ?? "").join("\n") + (part.state.error?.message ?? "")
        const size = estimate(output)
        results += size
        byTool.set(part.name, (byTool.get(part.name) ?? 0) + size)
      }
    }
  }
  const parts: Slice[] = [
    { label: "Your messages", tokens: yours, color: "#7FD6FF" },
    { label: "Images", tokens: images, color: "#EC4899" },
    { label: "Replies", tokens: replies, color: "#14E0A1" },
    { label: "Thinking", tokens: thinking, color: "#A855F7" },
    { label: "Tool calls", tokens: calls, color: "#FF9F0A" },
    { label: "Tool results", tokens: results, color: "#F87171" },
  ]
  const counted = parts.reduce((sum, part) => sum + part.tokens, 0)
  // What the conversation doesn't account for is the system prompt, instructions and
  // tool definitions sent with every step. If the estimate overshoots, scale it down.
  const scale = counted > used ? used / counted : 1
  const slices = parts.map((part) => ({ ...part, tokens: Math.round(part.tokens * scale) }))
  slices.push({ label: "System prompt, tools and instructions", tokens: Math.max(0, used - Math.round(counted * scale)), color: "#6c6c72" })
  const tools = [...byTool.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, tokens]) => ({ name, tokens: Math.round(tokens * scale) }))
  return { slices: slices.filter((slice) => slice.tokens > 0), tools, messages: messages.length }
}

function ContextBreakdown(props: { used: number; limit: number | undefined; load: () => Promise<Message[]>; onClose: () => void }) {
  let panel!: HTMLDivElement
  const [messages] = createResource(() => props.load())
  const data = () => (messages.latest ? breakdown(messages.latest, props.used) : undefined)
  onMount(() => {
    const onDown = (event: MouseEvent) => !panel.parentElement?.contains(event.target as Node) && props.onClose()
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose()
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    })
  })
  const percent = (tokens: number) => `${Math.round((tokens / props.used) * 100)}%`
  return (
    <div
      ref={panel}
      class="absolute top-full right-0 z-30 mt-1 w-[340px] rounded-xl border border-line bg-elevated p-4 text-[12px] shadow-[0_12px_40px_rgb(0_0_0/0.3)]"
    >
      <div class="mb-1 text-[13px] font-medium text-text">Context</div>
      <div class="mb-3 text-[11.5px] text-faint">
        {compact(props.used)} tokens{props.limit ? ` of ${compact(props.limit)} (${Math.round((props.used / props.limit) * 100)}%)` : ""}
        <Show when={data()}>{(value) => <span> · {value().messages} messages</span>}</Show>
      </div>
      <Show when={messages.error}>
        <div class="text-bad">Couldn't load the context: {String(messages.error?.message ?? messages.error)}</div>
      </Show>
      <Show when={data()} fallback={<Show when={!messages.error}><div class="text-faint">Loading…</div></Show>}>
        {(value) => (
          <>
            <div class="mb-3 flex h-2 overflow-hidden rounded-full bg-active">
              <For each={value().slices}>
                {(slice) => <div style={{ width: percent(slice.tokens), background: slice.color }} title={slice.label} />}
              </For>
            </div>
            <div class="flex flex-col gap-1.5">
              <For each={value().slices}>
                {(slice) => (
                  <div class="flex items-center gap-2">
                    <span class="size-2 shrink-0 rounded-full" style={{ background: slice.color }} />
                    <span class="min-w-0 flex-1 truncate text-muted">{slice.label}</span>
                    <span class="text-text tabular-nums">{compact(slice.tokens)}</span>
                    <span class="w-9 text-right text-faint tabular-nums">{percent(slice.tokens)}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={value().tools.length}>
              <div class="mt-3 mb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">Largest tool results</div>
              <For each={value().tools}>
                {(tool) => (
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{tool.name}</span>
                    <span class="text-faint tabular-nums">{compact(tool.tokens)}</span>
                  </div>
                )}
              </For>
            </Show>
            <div class="mt-3 text-[10.5px] leading-snug text-faint">
              The total is the model's own count from the last step; the split is estimated from text size.
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
