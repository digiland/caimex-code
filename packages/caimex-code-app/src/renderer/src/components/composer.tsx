import { createSignal, type JSX, Show } from "solid-js"

export function Composer(props: {
  busy: boolean
  controls?: JSX.Element
  placeholder?: string
  onSend: (text: string) => Promise<void>
  onStop: () => Promise<void>
}) {
  let input!: HTMLTextAreaElement
  const [text, setText] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [stopping, setStopping] = createSignal(false)

  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`
  }

  const send = async () => {
    const value = text().trim()
    if (!value || props.busy) return
    setError(undefined)
    setText("")
    input.value = ""
    resize()
    try {
      await props.onSend(value)
    } catch (cause) {
      // Give the words back rather than losing them.
      setText(value)
      input.value = value
      resize()
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const stop = async () => {
    setStopping(true)
    try {
      await props.onStop()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStopping(false)
    }
  }

  return (
    <div class="shrink-0 px-8 pb-5">
      <div class="mx-auto max-w-[780px]">
        <div class="rounded-2xl border border-line bg-elevated shadow-[0_2px_12px_rgb(0_0_0/0.12)] focus-within:border-[var(--muted)]">
          <textarea
            ref={input}
            rows={1}
            value={text()}
            placeholder={
              props.busy ? "Working… you can type your next message" : (props.placeholder ?? "Message Caimex Code")
            }
            onInput={(event) => {
              setText(event.currentTarget.value)
              resize()
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault()
                void send()
              }
            }}
            class="block max-h-[240px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed text-text outline-none placeholder:text-faint select-text"
          />
          <div class="flex items-center gap-1.5 px-2 pb-2">
            {props.controls}
            <div class="flex-1" />
            <Show
              when={props.busy}
              fallback={
                <button
                  onClick={() => void send()}
                  disabled={!text().trim()}
                  title="Send (Enter)"
                  class="flex size-8 items-center justify-center rounded-full bg-text text-bg disabled:opacity-25"
                >
                  <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              }
            >
              <button
                onClick={() => void stop()}
                disabled={stopping()}
                title="Stop"
                class="flex size-8 items-center justify-center rounded-full bg-text text-bg disabled:opacity-40"
              >
                <span class="size-2.5 rounded-[2px] bg-bg" />
              </button>
            </Show>
          </div>
        </div>
        <Show when={error()}>
          <div class="mt-2 px-1 text-[12px] text-bad select-text">{error()}</div>
        </Show>
      </div>
    </div>
  )
}
