import { createMemo, For, type JSX, Show } from "solid-js"
import { isAssistant, type PermissionReply, type Session } from "../api"
import { isBusy, type Conversation } from "../conversations"
import { compact } from "../format"
import { Composer } from "./composer"
import { ConversationView } from "./conversation"
import { PermissionCard, QuestionCard } from "./requests"

export function SessionView(props: {
  session: Session
  title: string
  conversation: Conversation | undefined
  running: boolean
  controls: JSX.Element
  onRetry: () => void
  onSend: (text: string) => Promise<void>
  onStop: () => Promise<void>
  onAnswer: (requestID: string, answers: string[][]) => Promise<void>
  onDismiss: (requestID: string) => Promise<void>
  onDecide: (requestID: string, reply: PermissionReply) => Promise<void>
}) {
  const assistants = createMemo(() => props.conversation?.messages.filter(isAssistant) ?? [])
  // Each step re-sends the whole conversation, so the latest step's input is the
  // context size; summing inputs would count the history once per step.
  const context = () => assistants().findLast((message) => message.tokens)?.tokens?.input

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
          {(value) => <div class="shrink-0 text-[11px] text-faint">{compact(value())} context</div>}
        </Show>
      </header>
      <Show
        when={props.conversation}
        fallback={<div class="flex-1" />}
      >
        {(conversation) => (
          <ConversationView
            conversation={conversation()}
            directory={props.session.location.directory}
            busy={isBusy(props.conversation, props.running)}
            onRetry={props.onRetry}
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
        onSend={props.onSend}
        onStop={props.onStop}
      />
    </div>
  )
}
