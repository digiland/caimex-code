import { createMemo, createResource, createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { AgentProfile, Agents } from "../agents"
import { fullTime, relativeTime } from "../format"
import { jobs, type AgentTarget, type Job } from "../hermes"
import { ask } from "./confirm"
import { Markdown } from "./markdown"

// Scheduled tasks: Hermes' cron jobs (/api/jobs), across every Hermes server the Work
// tab knows. Agents that share a server and profile share its jobs, so each server is
// listed once, under its first agent's name.

type Source = { key: string; target: AgentTarget; profile: AgentProfile; names: string[] }

export function sourcesOf(agents: Agents): Source[] {
  const byServer = new Map<string, Source>()
  for (const profile of agents.state.profiles) {
    const key = `${profile.baseURL}|${profile.profile ?? ""}`
    const found = byServer.get(key)
    if (found) found.names.push(profile.name)
    else
      byServer.set(key, {
        key,
        target: { id: profile.id, baseURL: profile.baseURL, profile: profile.profile },
        profile,
        names: [profile.name],
      })
  }
  return [...byServer.values()]
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : undefined)

// "in 4m" / "in 2h" for the future, "3m ago" for the past.
function when(ms: number) {
  if (ms <= Date.now()) return `${relativeTime(ms)}${relativeTime(ms) === "now" ? "" : " ago"}`
  const seconds = (ms - Date.now()) / 1000
  if (seconds < 60) return "in <1m"
  if (seconds < 3600) return `in ${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `in ${Math.round(seconds / 3600)}h`
  return new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
}

const STATES: Record<string, { label: string; tone: string }> = {
  scheduled: { label: "Scheduled", tone: "text-ok bg-ok/15" },
  running: { label: "Running", tone: "text-warn bg-warn/15" },
  paused: { label: "Paused", tone: "text-muted bg-active" },
  completed: { label: "Done", tone: "text-muted bg-active" },
  error: { label: "Failed", tone: "text-bad bg-bad/15" },
}

export function ScheduledView(props: { agents: Agents }) {
  const sources = createMemo(() => sourcesOf(props.agents))
  // undefined: closed; null: new; a job: editing it.
  const [editing, setEditing] = createSignal<{ source?: Source; job?: Job } | undefined>()
  const [tick, setTick] = createSignal(0)
  // Jobs change on their own (they run); refresh while this view is open.
  onMount(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 20_000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="flex h-full flex-col">
      <header class="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-6">
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-medium">Scheduled</div>
          <div class="text-[10.5px] text-faint">Tasks your agents run on a schedule</div>
        </div>
        <button
          onClick={() => setTick((value) => value + 1)}
          title="Refresh"
          class="no-drag flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
        >
          <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          disabled={!sources().length}
          onClick={() => setEditing({})}
          class="no-drag h-7 rounded-md bg-text px-3 text-[12px] font-medium text-bg disabled:opacity-40"
        >
          New task
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex max-w-[820px] flex-col gap-8 px-8 py-6">
          <Show when={!sources().length}>
            <div class="py-16 text-center text-[13px] text-muted">Add an agent first; its scheduled tasks show here.</div>
          </Show>
          <For each={sources()}>
            {(source) => (
              <SourceJobs
                source={source}
                tick={tick()}
                showHeading={sources().length > 1}
                onEdit={(job) => setEditing({ source, job })}
              />
            )}
          </For>
        </div>
      </div>
      <Show when={editing()}>
        {(value) => (
          <JobEditor
            sources={sources()}
            source={value().source}
            job={value().job}
            onClose={() => setEditing(undefined)}
            onSaved={() => setTick((current) => current + 1)}
          />
        )}
      </Show>
    </div>
  )
}

function SourceJobs(props: { source: Source; tick: number; showHeading: boolean; onEdit: (job: Job) => void }) {
  const [list, { refetch, mutate }] = createResource(
    () => [props.source.target, props.tick] as const,
    ([target]) => jobs.list(target),
  )
  const sorted = () =>
    [...(list.latest ?? [])].sort(
      (a, b) =>
        Number(a.state === "paused" || a.enabled === false) - Number(b.state === "paused" || b.enabled === false) ||
        (time(a.next_run_at) ?? Infinity) - (time(b.next_run_at) ?? Infinity),
    )
  const replace = (job: Job) => mutate((current) => current?.map((item) => (item.id === job.id ? job : item)))

  return (
    <section>
      <Show when={props.showHeading}>
        <div class="mb-2 flex items-center gap-2 text-[12px] font-medium text-muted">
          <span>{props.source.profile.emoji}</span>
          {props.source.names.join(", ")}
          <Show when={props.source.profile.profile}>
            <span class="font-mono font-normal text-faint">{props.source.profile.profile}</span>
          </Show>
        </div>
      </Show>
      <Switch>
        <Match when={list.error && !list.latest}>
          <div class="rounded-lg border border-line px-4 py-3 text-[12.5px] text-muted">
            <span class="text-bad">Couldn't load scheduled tasks.</span> {String(list.error?.message ?? list.error)}{" "}
            <button onClick={() => void refetch()} class="text-text underline">
              Try again
            </button>
          </div>
        </Match>
        <Match when={list.loading && !list.latest}>
          <div class="px-1 py-2 text-[12px] text-faint">Loading…</div>
        </Match>
        <Match when={list.latest && list.latest.length === 0}>
          <div class="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-faint">
            No scheduled tasks yet.
          </div>
        </Match>
        <Match when={list.latest}>
          <div class="flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-line">
            {/* Keyed by id: a refresh brings new objects, and an open row should stay open. */}
            <For each={sorted().map((job) => job.id)}>
              {(id) => (
                <Show when={list.latest?.find((item) => item.id === id)}>
                  {(job) => (
                <JobRow
                  job={job()}
                  target={props.source.target}
                  onChanged={replace}
                  onRemoved={() => mutate((current) => current?.filter((item) => item.id !== id))}
                  onEdit={() => props.onEdit(job())}
                />
                  )}
                </Show>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </section>
  )
}

function JobRow(props: {
  job: Job
  target: AgentTarget
  onChanged: (job: Job) => void
  onRemoved: () => void
  onEdit: () => void
}) {
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const paused = () => props.job.state === "paused" || props.job.enabled === false
  const state = () => STATES[paused() ? "paused" : (props.job.state ?? "scheduled")] ?? STATES.scheduled

  const act = async (label: string, action: () => Promise<Job | void>) => {
    setBusy(label)
    setError(undefined)
    try {
      const job = await action()
      if (job) props.onChanged(job)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const next = () => time(props.job.next_run_at)
  const last = () => time(props.job.last_run_at)

  return (
    <div class="group bg-bg">
      <div class="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen(!open())} class="flex min-w-0 flex-1 items-center gap-3 text-left">
          <svg
            viewBox="0 0 16 16"
            classList={{ "rotate-90": open() }}
            class="size-3 shrink-0 text-faint transition-transform"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          >
            <path d="m6 3.5 4.5 4.5L6 12.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span class="truncate text-[13.5px] text-text">{props.job.name}</span>
              <span class={`shrink-0 rounded-full px-1.5 py-px text-[10.5px] ${state().tone}`}>{state().label}</span>
              <Show when={props.job.no_agent}>
                <span class="shrink-0 rounded-full bg-active px-1.5 py-px text-[10.5px] text-muted">script</span>
              </Show>
            </span>
            <span class="mt-0.5 block truncate text-[11.5px] text-faint">
              <span class="font-mono">{props.job.schedule_display ?? props.job.schedule?.display}</span>
              <Show when={!paused() && next()}>{(ms) => <span title={fullTime(ms())}> · next {when(ms())}</span>}</Show>
              <Show when={last()}>
                {(ms) => (
                  <span title={fullTime(ms())}>
                    {" "}
                    · last {when(ms())}
                    <Show when={props.job.last_status}>
                      {(status) => (
                        <span classList={{ "text-bad": status() === "error", "text-ok": status() === "ok" }}> {status()}</span>
                      )}
                    </Show>
                  </span>
                )}
              </Show>
            </span>
          </span>
        </button>
        <div class="flex shrink-0 items-center gap-1 opacity-60 group-hover:opacity-100">
          <RowButton disabled={!!busy()} onClick={() => void act("run", () => jobs.run(props.target, props.job.id))}>
            {busy() === "run" ? "Starting…" : "Run now"}
          </RowButton>
          <RowButton
            disabled={!!busy()}
            onClick={() =>
              void act("pause", () => (paused() ? jobs.resume(props.target, props.job.id) : jobs.pause(props.target, props.job.id)))
            }
          >
            {paused() ? "Resume" : "Pause"}
          </RowButton>
          <RowButton disabled={!!busy()} onClick={props.onEdit}>
            Edit
          </RowButton>
          <RowButton
            danger
            disabled={!!busy()}
            onClick={async () => {
              if (
                !(await ask({
                  message: `Delete “${props.job.name}”?`,
                  detail: "The task is removed from the agent's schedule. Its past results stay on disk.",
                  confirm: "Delete",
                  danger: true,
                }))
              )
                return
              await act("delete", async () => {
                await jobs.remove(props.target, props.job.id)
                props.onRemoved()
              })
            }}
          >
            Delete
          </RowButton>
        </div>
      </div>
      <Show when={error()}>
        <div class="px-4 pb-3 pl-10 text-[12px] text-bad select-text">{error()}</div>
      </Show>
      <Show when={open()}>
        <JobDetail job={props.job} target={props.target} />
      </Show>
    </div>
  )
}

function RowButton(props: { onClick: () => void; disabled?: boolean; danger?: boolean; children: JSX.Element }) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      classList={{ "text-bad": props.danger, "text-muted hover:text-text": !props.danger }}
      class="h-7 rounded-md px-2 text-[12px] hover:bg-hover disabled:opacity-40"
    >
      {props.children}
    </button>
  )
}

function JobDetail(props: { job: Job; target: AgentTarget }) {
  const [outputs] = createResource(
    () => [props.target, props.job.id, props.job.last_run_at] as const,
    ([target, id]) => window.caimex.hermes.jobOutputs(target, id),
  )
  const [chosen, setChosen] = createSignal<string>()
  const shown = () => chosen() ?? outputs.latest?.[0]?.name
  const [output] = createResource(
    () => {
      const name = shown()
      return name ? { target: props.target, id: props.job.id, name } : undefined
    },
    (key) => window.caimex.hermes.jobOutput(key.target, key.id, key.name),
  )
  const outputTime = (name: string) => outputs.latest?.find((item) => item.name === name)?.time

  return (
    <div class="flex flex-col gap-4 border-t border-line bg-sidebar px-4 py-4 pl-10">
      <Detail label={props.job.no_agent ? "Script" : "Prompt"}>
        <pre class="max-h-[180px] overflow-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted select-text">
          {props.job.no_agent && props.job.script ? `${props.job.script}\n\n${props.job.prompt}` : props.job.prompt}
        </pre>
      </Detail>
      <Show when={props.job.last_error || props.job.last_delivery_error}>
        <Detail label="Last error">
          <div class="text-[12px] text-bad select-text">{props.job.last_error ?? props.job.last_delivery_error}</div>
        </Detail>
      </Show>
      <div class="flex gap-6 text-[11.5px] text-faint">
        <Show when={props.job.repeat?.completed !== undefined}>
          <span>
            {props.job.repeat!.completed} run{props.job.repeat!.completed === 1 ? "" : "s"}
            {props.job.repeat?.times ? ` of ${props.job.repeat.times}` : ""}
          </span>
        </Show>
        <Show when={props.job.created_at}>{(created) => <span>Created {fullTime(Date.parse(created()))}</span>}</Show>
      </div>
      <Detail label="Results">
        <Switch>
          <Match when={outputs.latest === undefined && !outputs.loading}>
            <div class="text-[12px] text-faint">
              Results are readable here when the agent runs on this Mac, and once the task has run.
            </div>
          </Match>
          <Match when={outputs.latest?.length === 0}>
            <div class="text-[12px] text-faint">No results yet.</div>
          </Match>
          <Match when={outputs.latest?.length}>
            <div class="flex min-h-0 gap-3">
              <div class="flex max-h-[360px] w-[150px] shrink-0 flex-col gap-0.5 overflow-y-auto">
                <For each={outputs.latest}>
                  {(item) => (
                    <button
                      onClick={() => setChosen(item.name)}
                      classList={{ "bg-active text-text": shown() === item.name, "text-muted hover:bg-hover": shown() !== item.name }}
                      class="rounded-md px-2 py-1 text-left text-[11.5px]"
                      title={fullTime(item.time)}
                    >
                      {when(item.time)}
                    </button>
                  )}
                </For>
              </div>
              <div class="max-h-[360px] min-w-0 flex-1 overflow-y-auto rounded-md border border-line bg-bg px-4 py-3 text-[13px]">
                <Show when={(shown() && outputTime(shown()!)) || undefined}>
                  {(ms) => <div class="mb-2 text-[11px] text-faint">{fullTime(ms())}</div>}
                </Show>
                <Show when={output.latest} fallback={<div class="text-[12px] text-faint">Loading…</div>}>
                  {(text) => <Markdown text={text()} />}
                </Show>
              </div>
            </div>
          </Match>
        </Switch>
      </Detail>
    </div>
  )
}

function Detail(props: { label: string; children: JSX.Element }) {
  return (
    <div>
      <div class="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">{props.label}</div>
      {props.children}
    </div>
  )
}

const EXAMPLES = ["every day at 8am", "weekdays at 9am", "every monday 9am", "every 2h", "in 30m", "0 18 * * 5"]

function JobEditor(props: {
  sources: Source[]
  source?: Source
  job?: Job
  onClose: () => void
  onSaved: () => void
}) {
  const [sourceKey, setSourceKey] = createSignal(props.source?.key ?? props.sources[0]?.key)
  const [name, setName] = createSignal(props.job?.name ?? "")
  const [schedule, setSchedule] = createSignal(props.job?.schedule_display ?? props.job?.schedule?.display ?? "")
  const [prompt, setPrompt] = createSignal(props.job?.prompt ?? "")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const source = () => props.sources.find((item) => item.key === sourceKey())

  onMount(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose()
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const save = async () => {
    const target = source()?.target
    if (!target) return
    if (!name().trim() || !schedule().trim() || (!prompt().trim() && !props.job?.no_agent))
      return setError("Give the task a name, a schedule and something to do.")
    setBusy(true)
    setError(undefined)
    try {
      if (props.job) {
        const originalSchedule = props.job.schedule_display ?? props.job.schedule?.display
        await jobs.update(target, props.job.id, {
          name: name().trim(),
          prompt: prompt(),
          ...(schedule().trim() !== originalSchedule ? { schedule: schedule().trim() } : {}),
        })
      } else await jobs.create(target, { name: name().trim(), schedule: schedule().trim(), prompt: prompt() })
      props.onSaved()
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-8"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div class="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-[0_20px_60px_rgb(0_0_0/0.35)]">
        <div class="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div class="text-[14px] font-medium">{props.job ? "Edit scheduled task" : "New scheduled task"}</div>
          <button onClick={props.onClose} class="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-text">
            Cancel
          </button>
        </div>
        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          <Show when={!props.job && props.sources.length > 1}>
            <Field label="Agent">
              <select
                value={sourceKey()}
                onChange={(event) => setSourceKey(event.currentTarget.value)}
                class={INPUT}
              >
                <For each={props.sources}>
                  {(item) => (
                    <option value={item.key}>
                      {item.profile.emoji} {item.names.join(", ")}
                    </option>
                  )}
                </For>
              </select>
            </Field>
          </Show>
          <Field label="Name">
            <input value={name()} onInput={(event) => setName(event.currentTarget.value)} placeholder="Morning news brief" class={INPUT} />
          </Field>
          <Field label="When" hint="Plain phrases, intervals, a one-off delay, or a cron expression.">
            <input
              value={schedule()}
              onInput={(event) => setSchedule(event.currentTarget.value)}
              placeholder="every day at 8am"
              class={`${INPUT} font-mono`}
            />
            <div class="flex flex-wrap gap-1.5">
              <For each={EXAMPLES}>
                {(example) => (
                  <button
                    onClick={() => setSchedule(example)}
                    class="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:bg-hover hover:text-text"
                  >
                    {example}
                  </button>
                )}
              </For>
            </div>
          </Field>
          <Field label={props.job?.no_agent ? "Notes" : "What to do"} hint={props.job?.no_agent ? "This is a script task; the script itself is set up in Hermes." : "The agent gets this as its prompt each time the task runs."}>
            <textarea
              value={prompt()}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              rows={6}
              placeholder="Summarise the top tech and telecoms news in Zimbabwe from the last 24 hours, with links."
              class={`${INPUT} h-auto resize-none py-2 leading-relaxed`}
            />
          </Field>
          <Show when={error()}>
            <div class="text-[12px] whitespace-pre-wrap text-bad select-text">{error()}</div>
          </Show>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            disabled={busy()}
            onClick={() => void save()}
            class="h-8 rounded-md bg-text px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-50"
          >
            {busy() ? "Saving…" : props.job ? "Save" : "Schedule it"}
          </button>
        </div>
      </div>
    </div>
  )
}

const INPUT =
  "h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-text outline-none placeholder:text-faint focus:border-[var(--muted)]"

function Field(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-1.5">
      <span class="text-[12px] font-medium text-muted">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-[11.5px] text-faint">{props.hint}</span>
      </Show>
    </label>
  )
}
