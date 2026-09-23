import { createMemo, For, type JSX, Show } from "solid-js"
import { isAssistant, type PermissionReply, type Session, type UserMessage } from "../api"
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
        <Show when={context()}>{(used) => <ContextMeter used={used()} limit={props.contextLimit} />}</Show>
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
// so this informs rather than offering an action.
function ContextMeter(props: { used: number; limit: number | undefined }) {
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
    <div class="flex shrink-0 items-center gap-2 text-[11px] text-faint" title={label()}>
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
    </div>
  )
}
