import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import { isInterruption, type AssistantMessage, type ReasoningPart, type UserMessage } from "../api"
import { compact, modelName } from "../format"
import { Markdown } from "./markdown"
import { Chevron, ToolView } from "./tools"

export function UserBubble(props: {
  text: string
  images?: string[]
  pending?: boolean
  actions?: JSX.Element
}) {
  return (
    <div class="group flex items-start justify-end gap-2">
      <div class="mt-2 opacity-0 transition-opacity group-hover:opacity-100">{props.actions}</div>
      <div
        classList={{ "opacity-60": props.pending }}
        class="max-w-[85%] rounded-2xl border border-line bg-elevated px-4 py-2.5 text-[14px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap select-text"
      >
        <Show when={props.images?.length}>
          <div class="mb-2 flex flex-wrap gap-2">
            <For each={props.images}>
              {(uri) => <img src={uri} alt="" class="max-h-40 max-w-[240px] rounded-lg border border-line object-cover" />}
            </For>
          </div>
        </Show>
        {props.text}
      </div>
    </div>
  )
}

export function User(props: { message: UserMessage; actions?: JSX.Element }) {
  const images = () =>
    (props.message.files as { uri?: string; mime?: string }[] | undefined)
      ?.filter((file) => file.mime?.startsWith("image/") && file.uri?.startsWith("data:"))
      .map((file) => file.uri!)
  return <UserBubble text={props.message.text} images={images()} actions={props.actions} />
}

export function Assistant(props: { message: AssistantMessage; directory: string }) {
  const open = () => !props.message.time.completed
  // Some models (DeepSeek through the gateway) emit the same words on both the reasoning
  // and the text channel. Which copy is noise depends on how the step ended:
  //  - it called a tool: the text is an echo of the thinking, so hide the text;
  //  - it ended the turn: the text is the answer, so hide the duplicate thinking;
  //  - still running: unknown, so hold a matching text back until it resolves.
  const final = () => props.message.finish !== undefined && props.message.finish !== "tool-calls"
  const reasonings = () =>
    props.message.content.flatMap((part) =>
      part.type === "reasoning" && part.time?.completed ? [part.text.trim()] : [],
    )
  const texts = () => props.message.content.flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
  const echo = (text: string) => {
    const value = text.trim()
    return !final() && value.length > 0 && reasonings().some((reasoning) => reasoning.startsWith(value))
  }
  const duplicate = (reasoning: string) => final() && texts().includes(reasoning.trim())
  return (
    <div class="flex flex-col gap-3">
      <For each={props.message.content}>
        {(part) => (
          <Switch>
            <Match when={part.type === "reasoning" ? part : undefined}>
              {(item) => (
                <Show when={!duplicate(item().text)}>
                  <Thinking part={item()} streaming={open() && !item().time?.completed} />
                </Show>
              )}
            </Match>
            <Match when={part.type === "text" ? part : undefined}>
              {(item) => (
                <Show when={item().text && !echo(item().text)}>
                  <Markdown text={item().text} />
                </Show>
              )}
            </Match>
            <Match when={part.type === "tool" ? part : undefined}>
              {(item) => <ToolView part={item()} directory={props.directory} />}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={isInterruption(props.message.error)}>
        <div class="text-[12px] text-faint">Stopped</div>
      </Show>
      <Show when={!isInterruption(props.message.error) && props.message.error}>
        {(error) => (
          <div class="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12.5px] text-text select-text">
            {error().message ?? "The step failed."}
          </div>
        )}
      </Show>
      {/* Usage closes a turn; intermediate tool-call steps stay quiet. */}
      <Show
        when={
          props.message.finish && props.message.finish !== "tool-calls" && (props.message.tokens?.input || props.message.tokens?.output)
            ? props.message.tokens
            : undefined
        }
      >
        {(tokens) => (
          <div class="text-[11px] text-faint">
            {props.message.model ? `${modelName(props.message.model.id)} · ` : ""}
            {compact(tokens().input)} in · {compact(tokens().output)} out
          </div>
        )}
      </Show>
    </div>
  )
}

function Thinking(props: { part: ReasoningPart; streaming: boolean }) {
  const [expanded, setExpanded] = createSignal(false)
  const seconds = () => {
    const time = props.part.time
    if (!time?.completed) return undefined
    return Math.max(1, Math.round((time.completed - time.created) / 1000))
  }
  return (
    <Show when={props.part.text || props.streaming}>
      <div>
        <button
          onClick={() => setExpanded(!expanded())}
          class="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-text"
        >
          <Show when={props.streaming} fallback={<span>Thought for {seconds() ?? 1}s</span>}>
            <span class="shimmer">Thinking…</span>
          </Show>
          <Chevron open={expanded()} />
        </button>
        <Show when={expanded() && props.part.text}>
          <div class="mt-2 border-l-2 border-line pl-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted select-text">
            {props.part.text}
          </div>
        </Show>
      </div>
    </Show>
  )
}
