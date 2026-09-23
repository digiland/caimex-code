import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import type { Agent, Model, ModelRef } from "../api"
import { modelName, projectName } from "../format"
import { contextLabel, isChatModel } from "../models"

// Opens upward: every picker lives in the composer at the bottom of the window.
function Popover(props: { onClose: () => void; class?: string; children: JSX.Element }) {
  let panel!: HTMLDivElement
  onMount(() => {
    const onDown = (event: MouseEvent) => {
      if (!panel.parentElement?.contains(event.target as Node)) props.onClose()
    }
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose()
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    })
  })
  return (
    <div
      ref={panel}
      class={`absolute bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-elevated shadow-[0_8px_30px_rgb(0_0_0/0.25)] ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  )
}

function Trigger(props: { onClick: () => void; disabled?: boolean; title?: string; children: JSX.Element }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      class="flex h-7 max-w-[260px] items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-text disabled:opacity-50"
    >
      {props.children}
      <svg viewBox="0 0 16 16" class="size-3 shrink-0 text-faint" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M5 6.5 8 4l3 2.5M5 9.5 8 12l3-2.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  )
}

export function ModelPicker(props: {
  models: Model[]
  value: ModelRef | undefined
  onChange: (model: Model) => void | Promise<void>
  disabled?: boolean
}) {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [all, setAll] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [error, setError] = createSignal<string>()
  const chat = createMemo(() => props.models.filter(isChatModel))
  const shown = createMemo(() => {
    const search = query().trim().toLowerCase()
    return (all() ? props.models : chat()).filter((model) => !search || model.id.toLowerCase().includes(search))
  })

  const choose = async (model: Model) => {
    setOpen(false)
    setError(undefined)
    try {
      await props.onChange(model)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") setCursor((value) => Math.min(value + 1, shown().length - 1))
    else if (event.key === "ArrowUp") setCursor((value) => Math.max(value - 1, 0))
    else if (event.key === "Enter" && shown()[cursor()]) void choose(shown()[cursor()])
    else return
    event.preventDefault()
  }

  return (
    <div class="relative">
      <Trigger
        disabled={props.disabled}
        title={error() ?? props.value?.id}
        onClick={() => {
          setQuery("")
          setCursor(0)
          setOpen(!open())
        }}
      >
        <span class="truncate" classList={{ "text-bad": !!error() }}>
          {props.value ? modelName(props.value.id) : "Choose a model"}
        </span>
      </Trigger>
      <Show when={open()}>
        <Popover onClose={() => setOpen(false)} class="w-[340px]">
          <input
            ref={(element) => queueMicrotask(() => element.focus())}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setCursor(0)
            }}
            onKeyDown={onKey}
            placeholder="Search models"
            class="w-full border-b border-line bg-transparent px-3 py-2.5 text-[13px] text-text outline-none placeholder:text-faint"
          />
          <div class="max-h-[320px] overflow-y-auto p-1">
            <For each={shown()} fallback={<div class="px-3 py-3 text-[12px] text-faint">No models match.</div>}>
              {(model, index) => (
                <button
                  onClick={() => void choose(model)}
                  onMouseEnter={() => setCursor(index())}
                  classList={{ "bg-hover": cursor() === index() }}
                  class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px] text-text">{modelName(model.id)}</span>
                    <Show when={model.id.includes("/")}>
                      <span class="block truncate text-[11px] text-faint">{model.id.slice(0, model.id.lastIndexOf("/"))}</span>
                    </Show>
                  </span>
                  <Show when={contextLabel(model)}>
                    <span class="shrink-0 text-[11px] text-faint">{contextLabel(model)}</span>
                  </Show>
                  <span class="w-3 shrink-0 text-[12px] text-text">{props.value?.id === model.id ? "✓" : ""}</span>
                </button>
              )}
            </For>
          </div>
          <button
            onClick={() => setAll(!all())}
            class="w-full border-t border-line px-3 py-2 text-left text-[11.5px] text-muted hover:bg-hover hover:text-text"
          >
            {all() ? `Only chat models (${chat().length})` : `Show all models (${props.models.length})`}
          </button>
        </Popover>
      </Show>
    </div>
  )
}

export function ModeSwitch(props: {
  agents: Agent[]
  value: string | undefined
  onChange: (agent: string) => void | Promise<void>
  disabled?: boolean
}) {
  const [error, setError] = createSignal<string>()
  const modes = () => props.agents.filter((agent) => agent.mode === "primary" && !agent.hidden)
  const change = async (name: string) => {
    if (name === props.value) return
    setError(undefined)
    try {
      await props.onChange(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Show when={modes().length > 1}>
      <div class="flex h-7 items-center rounded-md border border-line p-0.5" title={error()}>
        <For each={modes()}>
          {(agent) => (
            <button
              disabled={props.disabled}
              title={agent.description}
              onClick={() => void change(agent.id)}
              classList={{
                "bg-active text-text": (props.value ?? "build") === agent.id,
                "text-muted hover:text-text": (props.value ?? "build") !== agent.id,
              }}
              class="h-full rounded-[5px] px-2.5 text-[12px] capitalize disabled:opacity-50"
            >
              {agent.id}
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

export function ProjectPicker(props: { recent: string[]; value: string | undefined; onChange: (directory: string) => void }) {
  const [open, setOpen] = createSignal(false)
  const browse = async () => {
    setOpen(false)
    const directory = await window.caimex.pickFolder()
    if (directory) props.onChange(directory)
  }
  return (
    <div class="relative">
      <Trigger title={props.value} onClick={() => setOpen(!open())}>
        <svg viewBox="0 0 16 16" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
        </svg>
        <span class="truncate">{props.value ? projectName(props.value) : "Choose a project"}</span>
      </Trigger>
      <Show when={open()}>
        <Popover onClose={() => setOpen(false)} class="w-[360px]">
          <div class="max-h-[300px] overflow-y-auto p-1">
            <Show when={props.recent.length}>
              <div class="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">Recent</div>
            </Show>
            <For each={props.recent}>
              {(directory) => (
                <button
                  onClick={() => {
                    setOpen(false)
                    props.onChange(directory)
                  }}
                  class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-hover"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px] text-text">{projectName(directory)}</span>
                    <span class="block truncate font-mono text-[10.5px] text-faint">{directory}</span>
                  </span>
                  <span class="w-3 shrink-0 text-[12px]">{props.value === directory ? "✓" : ""}</span>
                </button>
              )}
            </For>
          </div>
          <button
            onClick={() => void browse()}
            class="w-full border-t border-line px-3 py-2.5 text-left text-[12.5px] text-text hover:bg-hover"
          >
            Choose folder…
          </button>
        </Popover>
      </Show>
    </div>
  )
}
