import { createEffect, createSignal, For, type JSX, on, onCleanup, Show } from "solid-js"
import type { Attachment } from "../conversations"

export type Suggestion = {
  // What the popover shows, and what selecting it inserts.
  label: string
  detail?: string
  insert: string
  // Keep suggesting after inserting (drilling into a folder).
  more?: boolean
}

export type Draft = { text: string; nonce: number }

// Only images reach the model: the gateway's provider rejects any other attachment type,
// and a rejected one fails every later turn in that session. Files go in by @path.
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

type Trigger = { kind: "mention" | "command"; query: string; start: number }

// The @token or leading /command the caret is in, if any.
function triggerAt(text: string, caret: number): Trigger | undefined {
  const before = text.slice(0, caret)
  const command = /^\/([\w-]*)$/.exec(before)
  if (command) return { kind: "command", query: command[1], start: 0 }
  const mention = /(^|\s)@([^\s@]*)$/.exec(before)
  if (mention) return { kind: "mention", query: mention[2], start: before.length - mention[2].length - 1 }
  return undefined
}

export function Composer(props: {
  busy: boolean
  controls?: JSX.Element
  placeholder?: string
  draft?: Draft
  onSend: (text: string, files: Attachment[]) => Promise<void>
  onStop: () => Promise<void>
  // Suggestions for the current @ or / token; undefined disables that trigger.
  suggest?: (kind: Trigger["kind"], query: string) => Promise<Suggestion[]>
  // Image attachments (on unless the backend can't take them).
  attachments?: boolean
  // Sending stays open while busy (the caller queues it), next to Stop.
  sendWhileBusy?: boolean
  busyPlaceholder?: string
}) {
  const blocked = () => props.busy && !props.sendWhileBusy
  let input!: HTMLTextAreaElement
  let picker!: HTMLInputElement
  const [text, setText] = createSignal("")
  const [files, setFiles] = createSignal<Attachment[]>([])
  const [error, setError] = createSignal<string>()
  const [stopping, setStopping] = createSignal(false)
  const [dragging, setDragging] = createSignal(false)
  const [trigger, setTrigger] = createSignal<Trigger>()
  const [items, setItems] = createSignal<Suggestion[]>([])
  const [cursor, setCursor] = createSignal(0)

  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`
  }
  const setValue = (value: string, caret = value.length) => {
    setText(value)
    input.value = value
    input.setSelectionRange(caret, caret)
    resize()
  }

  // Rewind hands back the message it removed so it can be edited and resent.
  createEffect(
    on(
      () => props.draft?.nonce,
      () => {
        if (!props.draft) return
        setValue(props.draft.text)
        input.focus()
      },
      { defer: true },
    ),
  )

  let lookup = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const refreshTrigger = () => {
    const found = props.suggest ? triggerAt(input.value, input.selectionStart ?? input.value.length) : undefined
    const previous = trigger()
    // Results for another query would read as answers to this one; only a refinement of
    // the same query keeps them on screen while the new ones load.
    if (!found || found.kind !== previous?.kind || !found.query.startsWith(previous.query)) setItems([])
    setTrigger(found)
    clearTimeout(timer)
    if (!found) return setItems([])
    const token = ++lookup
    timer = setTimeout(async () => {
      const result = await props.suggest!(found.kind, found.query).catch(() => [])
      if (token !== lookup) return
      setItems(result)
      setCursor(0)
    }, found.kind === "mention" ? 120 : 0)
  }

  const choose = (item: Suggestion) => {
    const found = trigger()
    if (!found) return
    const value = input.value
    const caret = input.selectionStart ?? value.length
    const inserted = item.more ? item.insert : `${item.insert} `
    const next = value.slice(0, found.start) + inserted + value.slice(caret)
    setValue(next, found.start + inserted.length)
    setTrigger(undefined)
    setItems([])
    if (item.more) refreshTrigger()
    input.focus()
  }

  const addFiles = async (list: FileList | File[]) => {
    setError(undefined)
    for (const file of Array.from(list)) {
      if (!IMAGE_TYPES.has(file.type)) {
        setError(`“${file.name}” isn't an image. Mention files with @ instead, e.g. @src/app.tsx.`)
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`“${file.name}” is over 5 MB.`)
        continue
      }
      const uri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      setFiles((current) => [...current, { uri, name: file.name || "pasted image" }])
    }
  }

  const send = async () => {
    const value = text().trim()
    const attached = files()
    if ((!value && !attached.length) || blocked()) return
    setError(undefined)
    setValue("")
    setFiles([])
    try {
      await props.onSend(value, attached)
    } catch (cause) {
      // Give the words and images back rather than losing them.
      setValue(value)
      setFiles(attached)
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

  const onKeyDown = (event: KeyboardEvent) => {
    const open = trigger() && items().length > 0
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setCursor((value) => (value + step + items().length) % items().length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        choose(items()[cursor()])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setTrigger(undefined)
        setItems([])
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div class="shrink-0 px-8 pb-5">
      <div class="relative mx-auto max-w-[780px]">
        <Show when={trigger() && items().length > 0}>
          <div class="absolute bottom-full left-0 z-20 mb-2 w-full max-w-[520px] overflow-hidden rounded-xl border border-line bg-elevated p-1 shadow-[0_8px_30px_rgb(0_0_0/0.25)]">
            <div class="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">
              {trigger()?.kind === "command" ? "Commands" : "Files"}
            </div>
            <For each={items()}>
              {(item, index) => (
                <button
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(item)
                  }}
                  onMouseEnter={() => setCursor(index())}
                  classList={{ "bg-hover": cursor() === index() }}
                  class="flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left"
                >
                  <span class="shrink-0 font-mono text-[12.5px] text-text">{item.label}</span>
                  <span class="min-w-0 truncate text-[11.5px] text-faint">{item.detail}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <div
          onDragOver={(event) => {
            if (props.attachments === false || !event.dataTransfer?.types.includes("Files")) return
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            setDragging(false)
            if (props.attachments === false || !event.dataTransfer?.files.length) return
            event.preventDefault()
            void addFiles(event.dataTransfer.files)
          }}
          classList={{ "border-[var(--muted)]": dragging() }}
          class="rounded-2xl border border-line bg-elevated shadow-[0_2px_12px_rgb(0_0_0/0.12)] focus-within:border-[var(--muted)]"
        >
          <Show when={files().length}>
            <div class="flex flex-wrap gap-2 px-3 pt-3">
              <For each={files()}>
                {(file, index) => (
                  <div class="group/thumb relative">
                    <img src={file.uri} alt={file.name} class="size-16 rounded-lg border border-line object-cover" />
                    <button
                      title="Remove"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index()))}
                      class="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-text text-[11px] text-bg group-hover/thumb:flex"
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <textarea
            ref={input}
            rows={1}
            value={text()}
            placeholder={
              props.busy
                ? (props.busyPlaceholder ?? "Working… you can type your next message")
                : (props.placeholder ?? "Message Caimex Code")
            }
            onInput={(event) => {
              setText(event.currentTarget.value)
              resize()
              refreshTrigger()
            }}
            onClick={refreshTrigger}
            onKeyDown={onKeyDown}
            onPaste={(event) => {
              const pasted = event.clipboardData?.files
              if (!pasted?.length || props.attachments === false) return
              event.preventDefault()
              void addFiles(pasted)
            }}
            class="block max-h-[240px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed text-text outline-none placeholder:text-faint select-text"
          />
          <div class="flex items-center gap-1.5 px-2 pb-2">
            <Show when={props.attachments !== false}>
            <button
              title="Attach images"
              onClick={() => picker.click()}
              class="flex size-7 items-center justify-center rounded-md text-[18px] leading-none text-muted hover:bg-hover hover:text-text"
            >
              +
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              class="hidden"
              onChange={(event) => {
                if (event.currentTarget.files) void addFiles(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
            </Show>
            {props.controls}
            <div class="flex-1" />
            <Show
              when={props.busy}
              fallback={
                <button
                  onClick={() => void send()}
                  disabled={!text().trim() && !files().length}
                  title="Send (Enter)"
                  class="flex size-8 items-center justify-center rounded-full bg-text text-bg disabled:opacity-25"
                >
                  <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              }
            >
              <Show when={props.sendWhileBusy}>
                <button
                  onClick={() => void send()}
                  disabled={!text().trim() && !files().length}
                  title="Queue for when this run finishes (Enter)"
                  class="flex h-8 items-center rounded-full border border-line px-3 text-[12px] text-muted hover:bg-hover hover:text-text disabled:opacity-40"
                >
                  Queue
                </button>
              </Show>
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
