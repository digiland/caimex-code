import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

export type PaletteItem = {
  id: string
  group: "Actions" | "Agents" | "Sessions" | "Models"
  label: string
  detail?: string
  shortcut?: string
  run: () => void
}

// Every word typed must appear somewhere in the label or detail.
function matches(item: PaletteItem, query: string) {
  const haystack = `${item.label} ${item.detail ?? ""}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

const GROUPS = ["Actions", "Agents", "Sessions", "Models"] as const

export function Palette(props: { items: PaletteItem[]; onClose: () => void }) {
  let input!: HTMLInputElement
  let list!: HTMLDivElement
  const [query, setQuery] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  // Sessions and models are many; without a query, only actions and recent sessions show.
  const shown = createMemo(() => {
    const filtered = props.items.filter((item) => matches(item, query()))
    const limited = query()
      ? filtered
      : filtered.filter(
          (item) => item.group === "Actions" || item.group === "Agents" || (item.group === "Sessions" && filtered.indexOf(item) < 20),
        )
    return GROUPS.flatMap((group) => limited.filter((item) => item.group === group).slice(0, query() ? 30 : 8))
  })

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    props.onClose()
    item.run()
  }

  onMount(() => {
    input.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        props.onClose()
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setCursor((value) => (value + step + shown().length) % Math.max(1, shown().length))
        list.querySelector(`[data-index="${cursor()}"]`)?.scrollIntoView({ block: "nearest" })
      } else if (event.key === "Enter") {
        event.preventDefault()
        run(shown()[cursor()])
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <div
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/30 px-8 pt-[14vh]"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div class="flex max-h-[60vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-[0_20px_60px_rgb(0_0_0/0.35)]">
        <input
          ref={input}
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setCursor(0)
          }}
          placeholder="Search actions, agents, sessions and models"
          class="border-b border-line bg-transparent px-4 py-3.5 text-[14px] text-text outline-none placeholder:text-faint"
        />
        <div ref={list} class="min-h-0 flex-1 overflow-y-auto p-1.5">
          <Show when={shown().length} fallback={<div class="px-3 py-4 text-[12.5px] text-faint">Nothing matches.</div>}>
            <For each={GROUPS}>
              {(group) => (
                <Show when={shown().some((item) => item.group === group)}>
                  <div class="px-2.5 pt-2 pb-1 text-[11px] text-faint">{group}</div>
                  <For each={shown().filter((item) => item.group === group)}>
                    {(item) => {
                      const index = () => shown().indexOf(item)
                      return (
                        <button
                          data-index={index()}
                          onClick={() => run(item)}
                          onMouseMove={() => setCursor(index())}
                          classList={{ "bg-hover": cursor() === index() }}
                          class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left"
                        >
                          <span class="min-w-0 flex-1 truncate text-[13px] text-text">{item.label}</span>
                          <Show when={item.detail}>
                            <span class="max-w-[45%] shrink truncate text-[11.5px] text-faint">{item.detail}</span>
                          </Show>
                          <Show when={item.shortcut}>
                            <span class="shrink-0 font-mono text-[11px] text-faint">{item.shortcut}</span>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </Show>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}
