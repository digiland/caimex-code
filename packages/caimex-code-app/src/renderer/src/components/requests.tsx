import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionReply, PermissionRequest, Question, QuestionRequest } from "../api"

// Requests the agent is blocked on, shown above the composer like Claude Code does.

const ACTIONS: Record<string, string> = {
  bash: "Run a command",
  edit: "Edit a file",
  write: "Write a file",
  read: "Read a file",
  webfetch: "Fetch a web page",
  websearch: "Search the web",
  external_directory: "Access files outside this project",
  task: "Start a sub-agent",
}

export function PermissionCard(props: {
  request: PermissionRequest
  onDecide: (reply: PermissionReply) => Promise<void>
}) {
  const [busy, setBusy] = createSignal<PermissionReply>()
  const [error, setError] = createSignal<string>()
  const decide = async (reply: PermissionReply) => {
    setBusy(reply)
    setError(undefined)
    try {
      await props.onDecide(reply)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(undefined)
    }
  }
  const command = () => {
    const value = props.request.metadata?.command
    return typeof value === "string" ? value : undefined
  }

  return (
    <div class="rounded-xl border border-warn/50 bg-elevated p-4 shadow-[0_2px_12px_rgb(0_0_0/0.12)]">
      <div class="mb-1 flex items-center gap-2 text-[12px] font-medium text-warn">
        <span class="size-1.5 rounded-full bg-warn" /> Permission needed
      </div>
      <div class="mb-2.5 text-[14px] text-text">{ACTIONS[props.request.action] ?? props.request.action}</div>
      <Show when={command() ?? props.request.resources.join("\n")}>
        {(text) => (
          <pre class="mb-3 max-h-[140px] overflow-auto rounded-md bg-sidebar px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted select-text">
            {text()}
          </pre>
        )}
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <button
          disabled={!!busy()}
          onClick={() => void decide("once")}
          class="h-8 rounded-md bg-text px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-50"
        >
          Allow once
        </button>
        <button
          disabled={!!busy()}
          onClick={() => void decide("always")}
          title={props.request.save?.length ? `Remember for: ${props.request.save.join(", ")}` : undefined}
          class="h-8 rounded-md border border-line px-3.5 text-[12.5px] text-text hover:bg-hover disabled:opacity-50"
        >
          Always allow
        </button>
        <button
          disabled={!!busy()}
          onClick={() => void decide("reject")}
          class="h-8 rounded-md px-3 text-[12.5px] text-muted hover:bg-hover hover:text-text disabled:opacity-50"
        >
          Deny
        </button>
        <Show when={error()}>
          <span class="text-[12px] text-bad">{error()}</span>
        </Show>
      </div>
    </div>
  )
}

export function QuestionCard(props: {
  request: QuestionRequest
  onAnswer: (answers: string[][]) => Promise<void>
  onDismiss: () => Promise<void>
}) {
  // Per question: chosen option labels, plus free text when "Other" is picked.
  const [picks, setPicks] = createStore<{ labels: string[]; other: boolean; text: string }[]>(
    props.request.questions.map(() => ({ labels: [], other: false, text: "" })),
  )
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const toggle = (index: number, question: Question, label: string) => {
    if (question.multiple)
      setPicks(index, "labels", (labels) =>
        labels.includes(label) ? labels.filter((item) => item !== label) : [...labels, label],
      )
    else setPicks(index, { labels: [label], other: false })
  }
  const toggleOther = (index: number, question: Question) => {
    if (question.multiple) setPicks(index, "other", (value) => !value)
    else setPicks(index, { labels: [], other: true })
  }
  const answers = () =>
    picks.map((pick) => [...pick.labels, ...(pick.other && pick.text.trim() ? [pick.text.trim()] : [])])
  const complete = () => answers().every((answer) => answer.length > 0)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <div class="rounded-xl border border-line bg-elevated p-4 shadow-[0_2px_12px_rgb(0_0_0/0.12)]">
      <For each={props.request.questions}>
        {(question, index) => (
          <div classList={{ "mt-4": index() > 0 }}>
            <div class="mb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{question.header}</div>
            <div class="mb-3 text-[14px] leading-snug text-text select-text">{question.question}</div>
            <div class="flex flex-col gap-1.5">
              <For each={question.options}>
                {(option) => {
                  const chosen = () => picks[index()].labels.includes(option.label)
                  return (
                    <button
                      disabled={busy()}
                      onClick={() => toggle(index(), question, option.label)}
                      classList={{ "border-[var(--muted)] bg-active": chosen(), "border-line hover:bg-hover": !chosen() }}
                      class="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left"
                    >
                      <Mark chosen={chosen()} square={!!question.multiple} />
                      <span class="min-w-0">
                        <span class="block text-[13px] text-text">{option.label}</span>
                        <span class="block text-[12px] leading-snug text-muted">{option.description}</span>
                      </span>
                    </button>
                  )
                }}
              </For>
              <Show when={question.custom !== false}>
                <div
                  classList={{
                    "border-[var(--muted)] bg-active": picks[index()].other,
                    "border-line": !picks[index()].other,
                  }}
                  class="flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <button disabled={busy()} onClick={() => toggleOther(index(), question)} class="flex items-center">
                    <Mark chosen={picks[index()].other} square={!!question.multiple} />
                  </button>
                  <input
                    disabled={busy()}
                    value={picks[index()].text}
                    onFocus={() => !picks[index()].other && toggleOther(index(), question)}
                    onInput={(event) => setPicks(index(), "text", event.currentTarget.value)}
                    placeholder="Other…"
                    class="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
                  />
                </div>
              </Show>
            </div>
          </div>
        )}
      </For>
      <div class="mt-4 flex items-center gap-2">
        <button
          disabled={busy() || !complete()}
          onClick={() => void run(() => props.onAnswer(answers()))}
          class="h-8 rounded-md bg-text px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-40"
        >
          Submit
        </button>
        <button
          disabled={busy()}
          onClick={() => void run(props.onDismiss)}
          class="h-8 rounded-md px-3 text-[12.5px] text-muted hover:bg-hover hover:text-text disabled:opacity-50"
        >
          Dismiss
        </button>
        <Show when={error()}>
          <span class="text-[12px] text-bad">{error()}</span>
        </Show>
      </div>
    </div>
  )
}

function Mark(props: { chosen: boolean; square: boolean }) {
  return (
    <span
      class="mt-[2px] flex size-4 shrink-0 items-center justify-center border"
      classList={{
        "rounded-full": !props.square,
        "rounded-[4px]": props.square,
        "border-text bg-text": props.chosen,
        "border-[var(--faint)]": !props.chosen,
      }}
    >
      <Show when={props.chosen}>
        <span class="size-1.5 rounded-full bg-bg" classList={{ "rounded-[1px]": props.square }} />
      </Show>
    </span>
  )
}
