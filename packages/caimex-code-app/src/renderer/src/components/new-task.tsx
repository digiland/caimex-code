import { createSignal, For, type JSX, Show } from "solid-js"
import type { Agent } from "../api"
import type { Attachment } from "../conversations"
import { Composer, type Suggestion } from "./composer"
import { MODE_COLORS } from "./work"

// The work modes the caimex-work plugin adds, in the order they're offered.
export const WORK_MODES = [
  { id: "research", label: "Research", hint: "Search, read, cross-check and write a cited report", example: "/brief Liquid Intelligent Technologies" },
  { id: "analyst", label: "Analyst", hint: "Work through spreadsheets, CSVs and exports with scripts", example: "/analyse ~/Downloads/sales-q3.csv" },
  { id: "writer", label: "Writer", hint: "Draft emails, memos and proposals in house style", example: "/draft a memo proposing a pilot of …" },
  { id: "ops", label: "Ops", hint: "Read logs and alarms, find what went wrong, write it up", example: "/digest ~/logs/alarms-2026-09-23.csv" },
] as const

export type WorkMode = (typeof WORK_MODES)[number]["id"]

export function NewTaskView(props: {
  agents: Agent[] | undefined
  mode: WorkMode
  onMode: (mode: WorkMode) => void
  // Undefined until the daemon has been asked; false when the plugin isn't loaded.
  ready: boolean | undefined
  onEnable: () => Promise<void>
  controls: JSX.Element
  onSend: (text: string, files: Attachment[]) => Promise<void>
  suggest: (kind: "mention" | "command", query: string) => Promise<Suggestion[]>
}) {
  const [enabling, setEnabling] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const enable = async () => {
    setEnabling(true)
    setError(undefined)
    try {
      await props.onEnable()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setEnabling(false)
    }
  }
  const current = () => WORK_MODES.find((mode) => mode.id === props.mode) ?? WORK_MODES[0]

  return (
    <div class="flex h-full flex-col">
      <div class="drag h-[52px] shrink-0" />
      {/* Everything here belongs to one question — pick a mode, describe the task —
          so it is laid out as a single centred group. Pinning the composer to the
          bottom instead opened a gap in the middle of that group, which reads as
          something failing to load rather than as deliberate space. */}
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto">
        <div class="px-8 text-center">
          <div class="text-[18px] font-medium text-text">What should we work on?</div>
          <div class="mt-1 text-[12.5px] text-muted">Each task gets its own folder; results are saved there as files.</div>
        </div>
        <Show
          when={props.ready !== false}
          fallback={
            <div class="mx-8 max-w-[460px] rounded-xl border border-line bg-elevated p-5 text-center">
              <div class="mb-1 text-[14px] font-medium text-text">Turn on work modes</div>
              <div class="mb-4 text-[12.5px] leading-relaxed text-muted">
                Adds Research, Analyst, Writer and Ops to the Caimex daemon, with commands like /research, /brief and
                /draft. The daemon restarts once, which interrupts anything running.
              </div>
              <button
                disabled={enabling()}
                onClick={() => void enable()}
                class="h-9 rounded-md bg-text px-4 text-[13px] font-medium text-bg disabled:opacity-50"
              >
                {enabling() ? "Turning on…" : "Turn on work modes"}
              </button>
              <Show when={error()}>
                <div class="mt-3 text-[12px] text-bad select-text">{error()}</div>
              </Show>
            </div>
          }
        >
          <div class="grid w-full max-w-[780px] grid-cols-2 gap-2.5 px-8">
            <For each={WORK_MODES}>
              {(mode) => {
                const chosen = () => props.mode === mode.id
                return (
                  <button
                    onClick={() => props.onMode(mode.id)}
                    classList={{ "border-[var(--muted)] bg-active": chosen(), "border-line hover:bg-hover": !chosen() }}
                    class="flex flex-col gap-1 rounded-xl border px-4 py-3 text-left"
                  >
                    <span class="flex items-center gap-2 text-[13.5px] font-medium text-text">
                      <span class="size-2 rounded-full" style={{ background: MODE_COLORS[mode.id] }} />
                      {mode.label}
                    </span>
                    <span class="text-[12px] leading-snug text-muted">{mode.hint}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={props.ready !== false}>
          <div class="w-full">
            <div class="mx-auto max-w-[780px] px-9 pb-1.5 text-[11.5px] text-faint">
              Try <span class="font-mono">{current().example}</span>, or just describe the task. Type / for commands.
            </div>
            <Composer
              busy={false}
              onSend={props.onSend}
              onStop={async () => {}}
              controls={props.controls}
              suggest={props.suggest}
              placeholder={`Describe a ${current().label.toLowerCase()} task…`}
            />
          </div>
        </Show>
      </div>
    </div>
  )
}
