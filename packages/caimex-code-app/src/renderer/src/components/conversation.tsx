import { createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { isAssistant, isUser, type Message, type UserMessage } from "../api"
import type { Conversation } from "../conversations"
import { Assistant, User, UserBubble } from "./messages"

export function ConversationView(props: {
  conversation: Conversation
  directory: string
  busy: boolean
  onRetry: () => void
  onRetrySend: () => void
  // Per-message actions (rewind) shown beside the user's own messages.
  userActions?: (message: UserMessage, index: number) => JSX.Element
}) {
  let scroller!: HTMLDivElement
  let content!: HTMLDivElement
  // Follow new output only while the reader is already at the bottom.
  let stick = true

  onMount(() => {
    scroller.scrollTop = scroller.scrollHeight
    const observer = new MutationObserver(() => {
      if (stick) requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight))
    })
    observer.observe(content, { childList: true, subtree: true, characterData: true })
    onCleanup(() => observer.disconnect())
  })

  const onScroll = () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  }

  return (
    <div ref={scroller} onScroll={onScroll} class="min-h-0 flex-1 overflow-y-auto">
      <div ref={content} class="mx-auto flex max-w-[780px] flex-col gap-6 px-8 pt-8 pb-10">
        <Switch>
          <Match when={props.conversation.status === "loading" && props.conversation.messages.length === 0}>
            <div class="py-16 text-center text-[13px] text-faint">Loading conversation…</div>
          </Match>
          <Match when={props.conversation.status === "error"}>
            <div class="py-16 text-center text-[13px] text-muted">
              <div class="mb-2 text-bad">Couldn't load this conversation</div>
              <div class="mb-4 select-text">{props.conversation.error}</div>
              <button class="text-text underline" onClick={props.onRetry}>
                Try again
              </button>
            </div>
          </Match>
          <Match
            when={
              props.conversation.messages.length === 0 &&
              props.conversation.pending.length === 0 &&
              props.conversation.legacy.length === 0
            }
          >
            <div class="py-16 text-center text-[13px] text-faint">Send a message to start.</div>
          </Match>
        </Switch>

        <Show when={props.conversation.legacy.length}>
          <Show when={props.conversation.legacyHasMore}>
            <div class="text-center text-[11px] text-faint">Earlier messages aren't shown.</div>
          </Show>
          <For each={props.conversation.legacy}>{(message) => <MessageView message={message} directory={props.directory} />}</For>
          <div class="flex items-center gap-3 text-[11px] text-faint">
            <span class="h-px flex-1 bg-line" />
            Earlier history from the older engine · not sent to the model
            <span class="h-px flex-1 bg-line" />
          </div>
        </Show>

        <Show when={props.conversation.hasMore}>
          <div class="text-center text-[11px] text-faint">Earlier messages aren't shown.</div>
        </Show>

        <For each={props.conversation.messages}>
          {(message, index) => (
            <MessageView
              message={message}
              directory={props.directory}
              actions={isUser(message) ? props.userActions?.(message, index()) : undefined}
            />
          )}
        </For>

        <For each={props.conversation.pending}>
          {(item) => <UserBubble text={item.text} images={item.files.map((file) => file.uri)} pending />}
        </For>

        <Show when={props.conversation.stalled && !props.busy}>
          <div class="flex items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-text">
            <span class="flex-1">This message didn't start a reply. The daemon accepted it but never answered.</span>
            <button onClick={props.onRetrySend} class="rounded-md bg-text px-3 py-1 text-[12px] font-medium text-bg">
              Retry
            </button>
          </div>
        </Show>

        <Show when={props.busy && !streaming(props.conversation)}>
          <Working />
        </Show>
      </div>
    </div>
  )
}

function MessageView(props: { message: Message; directory: string; actions?: JSX.Element }) {
  return (
    <Switch>
      <Match when={isUser(props.message) && props.message}>
        {(item) => <User message={item()} actions={props.actions} />}
      </Match>
      <Match when={isAssistant(props.message) && props.message}>
        {(item) => <Assistant message={item()} directory={props.directory} />}
      </Match>
    </Switch>
  )
}

// True while the open turn is visibly producing output, so the generic indicator
// doesn't sit underneath text or thinking that is already streaming.
function streaming(conversation: Conversation) {
  const message = conversation.messages.at(-1)
  if (!message || !isAssistant(message) || message.time.completed) return false
  const part = message.content.at(-1)
  if (!part) return false
  if (part.type === "text") return true
  if (part.type === "reasoning") return !part.time?.completed
  return part.state.status === "pending" || part.state.status === "running"
}

function Working() {
  const started = Date.now()
  const [elapsed, setElapsed] = createSignal(0)
  const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
  onCleanup(() => clearInterval(timer))
  return (
    <div class="flex items-center gap-2 text-[12.5px]">
      <span class="shimmer">Working…</span>
      <Show when={elapsed() >= 3}>
        <span class="text-faint">{elapsed()}s</span>
      </Show>
    </div>
  )
}
