import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import { isInterruption, type ToolPart } from "../api"

// Rendering for each tool call. The shapes read here (structured.files[].patch for
// edit, structured.value for grep/glob, structured.exit for bash, ...) are what the
// daemon's tools actually return, sampled from real runs.

type Structured = Record<string, unknown>

const LABELS: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  webfetch: "Fetch",
  websearch: "Web search",
  question: "Question",
  "apply-patch": "Patch",
  apply_patch: "Patch",
  skill: "Skill",
  task: "Task",
}

export function ToolView(props: { part: ToolPart; directory: string }) {
  return (
    <Switch fallback={<Generic part={props.part} directory={props.directory} />}>
      <Match when={props.part.name === "todowrite"}>
        <Todos part={props.part} />
      </Match>
      <Match when={props.part.name === "bash"}>
        <Bash part={props.part} />
      </Match>
      <Match when={props.part.name === "edit"}>
        <Edit part={props.part} directory={props.directory} />
      </Match>
      <Match when={props.part.name === "write"}>
        <Write part={props.part} directory={props.directory} />
      </Match>
      <Match when={props.part.name === "read"}>
        <Read part={props.part} directory={props.directory} />
      </Match>
      <Match when={props.part.name === "grep" || props.part.name === "glob"}>
        <Search part={props.part} />
      </Match>
    </Switch>
  )
}

// ---------------------------------------------------------------------------
// shared pieces

const input = (part: ToolPart) => part.state.input ?? {}
const structured = (part: ToolPart) => (part.state.structured ?? {}) as Structured
const str = (value: unknown) => (typeof value === "string" ? value : undefined)
const texts = (part: ToolPart) =>
  (part.state.content ?? [])
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n")

function relative(path: string | undefined, directory: string) {
  if (!path) return undefined
  return path.startsWith(directory + "/") ? path.slice(directory.length + 1) : path
}

function running(part: ToolPart) {
  return part.state.status === "pending" || part.state.status === "running"
}

function Card(props: {
  part: ToolPart
  label: string
  summary?: string
  meta?: JSX.Element
  open?: boolean
  children: JSX.Element
}) {
  const [expanded, setExpanded] = createSignal(props.open ?? false)
  const stopped = () => props.part.state.status === "error" && isInterruption(props.part.state.error)
  const tone = () => {
    if (stopped()) return "bg-faint"
    if (props.part.state.status === "completed") return "bg-ok"
    if (props.part.state.status === "error") return "bg-bad"
    return "bg-warn animate-pulse"
  }
  return (
    <div class="overflow-hidden rounded-lg border border-line">
      <button
        onClick={() => setExpanded(!expanded())}
        class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-hover"
      >
        <span class={`size-1.5 shrink-0 rounded-full ${tone()}`} />
        <span class="shrink-0 font-medium text-text">{props.label}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{props.summary}</span>
        <Show when={stopped()}>
          <span class="shrink-0 text-[11px] text-faint">stopped</span>
        </Show>
        <Show when={!stopped() && props.meta}>
          <span class="shrink-0 text-[11px] text-faint">{props.meta}</span>
        </Show>
        <Chevron open={expanded()} />
      </button>
      <Show when={expanded()}>
        <div class="border-t border-line bg-sidebar">
          <Show when={props.part.state.status === "error" && !stopped()} fallback={props.children}>
            <Output text={props.part.state.error?.message ?? "The tool failed."} tone="text-del-fg" />
          </Show>
        </div>
      </Show>
    </div>
  )
}

function Output(props: { text: string; tone?: string }) {
  return (
    <pre
      class={`max-h-[340px] overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap select-text ${props.tone ?? "text-muted"}`}
    >
      {props.text}
    </pre>
  )
}

const MAX_LINES = 400

function Code(props: { text: string; start?: number }) {
  const lines = () => {
    const all = props.text.replace(/\n$/, "").split("\n")
    return { shown: all.slice(0, MAX_LINES), hidden: Math.max(0, all.length - MAX_LINES) }
  }
  return (
    <div class="max-h-[360px] overflow-auto py-2 font-mono text-[11.5px] leading-[1.6] select-text">
      <For each={lines().shown}>
        {(line, index) => (
          <div class="flex">
            <span class="w-10 shrink-0 pr-3 text-right text-faint select-none">{(props.start ?? 1) + index()}</span>
            <span class="pr-3 whitespace-pre-wrap text-text">{line || " "}</span>
          </div>
        )}
      </For>
      <Show when={lines().hidden}>
        <div class="px-3 pt-1 text-faint">… {lines().hidden} more lines</div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// bash

function Bash(props: { part: ToolPart }) {
  const command = () => str(input(props.part).command) ?? ""
  const exit = () => structured(props.part).exit as number | undefined
  // The tool appends its own "Command exited with code N." line; the badge says that.
  const output = () =>
    texts(props.part)
      .split("\n")
      .filter((line) => !/^Command exited with code -?\d+\.$/.test(line))
      .join("\n")
      .replace(/\n+$/, "")
  return (
    <Card
      part={props.part}
      label="Bash"
      summary={command().split("\n")[0]}
      meta={
        <Show when={exit() !== undefined && exit() !== 0}>
          <span class="text-del-fg">exit {exit()}</span>
        </Show>
      }
    >
      <div class="max-h-[360px] overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed select-text">
        <div class="whitespace-pre-wrap text-text">
          <span class="text-faint select-none">$ </span>
          {command()}
        </div>
        <Show when={output()} fallback={<div class="mt-1 text-faint">{running(props.part) ? "Running…" : "(no output)"}</div>}>
          <div class="mt-1.5 whitespace-pre-wrap text-muted">{output()}</div>
        </Show>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// edit

type DiffLine = { kind: "add" | "del" | "ctx" | "hunk"; text: string; old?: number; new?: number }

function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = []
  let old = 0
  let now = 0
  for (const line of patch.split("\n")) {
    if (/^(Index:|====|--- |\+\+\+ )/.test(line)) continue
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      old = Number(hunk[1])
      now = Number(hunk[2])
      out.push({ kind: "hunk", text: line })
    } else if (line.startsWith("+")) out.push({ kind: "add", text: line.slice(1), new: now++ })
    else if (line.startsWith("-")) out.push({ kind: "del", text: line.slice(1), old: old++ })
    else if (line.startsWith(" ")) out.push({ kind: "ctx", text: line.slice(1), old: old++, new: now++ })
  }
  return out
}

type FileDiff = { file: string; lines: DiffLine[]; additions: number; deletions: number }

function diffs(part: ToolPart, directory: string): FileDiff[] {
  const files = structured(part).files as
    | { file?: string; patch?: string; additions?: number; deletions?: number }[]
    | undefined
  if (files?.length)
    return files.map((file) => ({
      file: relative(file.file, directory) ?? "",
      lines: parsePatch(file.patch ?? ""),
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    }))
  // Before the tool finishes there is no patch yet; show the requested change.
  const before = str(input(part).oldString)
  const after = str(input(part).newString)
  if (before === undefined && after === undefined) return []
  const del = (before ?? "").split("\n").map((text) => ({ kind: "del" as const, text }))
  const add = (after ?? "").split("\n").map((text) => ({ kind: "add" as const, text }))
  return [
    {
      file: relative(str(input(part).path), directory) ?? "",
      lines: [...del, ...add],
      additions: add.length,
      deletions: del.length,
    },
  ]
}

function Edit(props: { part: ToolPart; directory: string }) {
  const files = () => diffs(props.part, props.directory)
  const counts = () =>
    files().reduce((sum, file) => ({ add: sum.add + file.additions, del: sum.del + file.deletions }), { add: 0, del: 0 })
  return (
    <Card
      part={props.part}
      label="Edit"
      summary={relative(str(input(props.part).path), props.directory)}
      open
      meta={
        <Show when={counts().add || counts().del}>
          <span class="text-add-fg">+{counts().add}</span> <span class="text-del-fg">−{counts().del}</span>
        </Show>
      }
    >
      <For each={files()} fallback={<Output text={running(props.part) ? "Preparing edit…" : "No changes."} />}>
        {(file) => (
          <div class="max-h-[420px] overflow-auto py-1.5 font-mono text-[11.5px] leading-[1.6] select-text">
            <Show when={files().length > 1}>
              <div class="px-3 py-1 text-faint">{file.file}</div>
            </Show>
            <For each={file.lines}>
              {(line) => (
                <Show
                  when={line.kind !== "hunk"}
                  fallback={<div class="px-3 py-0.5 text-faint">{line.text.replace(/^@@.*@@\s?/, "⋯ ")}</div>}
                >
                  <div
                    class="flex"
                    classList={{ "bg-add-bg": line.kind === "add", "bg-del-bg": line.kind === "del" }}
                  >
                    <span class="w-9 shrink-0 pr-2 text-right text-faint select-none">{line.old ?? ""}</span>
                    <span class="w-9 shrink-0 pr-2 text-right text-faint select-none">{line.new ?? ""}</span>
                    <span
                      class="w-4 shrink-0 select-none"
                      classList={{ "text-add-fg": line.kind === "add", "text-del-fg": line.kind === "del" }}
                    >
                      {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                    </span>
                    <span
                      class="pr-3 whitespace-pre-wrap"
                      classList={{
                        "text-add-fg": line.kind === "add",
                        "text-del-fg": line.kind === "del",
                        "text-text": line.kind === "ctx",
                      }}
                    >
                      {line.text || " "}
                    </span>
                  </div>
                </Show>
              )}
            </For>
          </div>
        )}
      </For>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// write / read

function Write(props: { part: ToolPart; directory: string }) {
  const content = () => str(input(props.part).content) ?? ""
  const lines = () => content().replace(/\n$/, "").split("\n").length
  return (
    <Card
      part={props.part}
      label={structured(props.part).existed ? "Overwrite" : "Write"}
      summary={relative(str(input(props.part).path), props.directory)}
      meta={<>{lines()} lines</>}
      open
    >
      <Code text={content()} />
    </Card>
  )
}

function Read(props: { part: ToolPart; directory: string }) {
  const content = () => str(structured(props.part).content)
  const lines = () => content()?.replace(/\n$/, "").split("\n").length
  return (
    <Card
      part={props.part}
      label="Read"
      summary={relative(str(input(props.part).path), props.directory)}
      meta={<Show when={lines()}>{lines()} lines</Show>}
    >
      <Show when={content()} fallback={<Output text={texts(props.part) || "Reading…"} />}>
        {(text) => <Code text={text()} start={(input(props.part).offset as number | undefined) ?? 1} />}
      </Show>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// grep / glob

function Search(props: { part: ToolPart }) {
  const grep = () => props.part.name === "grep"
  const results = () =>
    (structured(props.part).value as { path?: string; entry?: { path?: string }; line?: number; text?: string }[] | undefined) ??
    []
  const noun = () => (grep() ? (results().length === 1 ? "match" : "matches") : results().length === 1 ? "file" : "files")
  return (
    <Card
      part={props.part}
      label={grep() ? "Grep" : "Glob"}
      summary={str(input(props.part).pattern)}
      meta={
        <Show when={props.part.state.status === "completed" && Array.isArray(structured(props.part).value)}>
          {results().length} {noun()}
        </Show>
      }
    >
      <Show
        when={results().length}
        fallback={<Output text={running(props.part) ? "Searching…" : texts(props.part) || "No results."} />}
      >
        <div class="max-h-[320px] overflow-auto py-2 font-mono text-[11.5px] leading-[1.6] select-text">
          <For each={results()}>
            {(result) => (
              <div class="flex gap-3 px-3">
                <span class="shrink-0 text-text">
                  {result.entry?.path ?? result.path}
                  <Show when={result.line}>
                    <span class="text-faint">:{result.line}</span>
                  </Show>
                </span>
                <Show when={result.text}>
                  <span class="truncate text-muted">{result.text?.trim()}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// todowrite: a checklist, always visible, like Claude Code's plan

type Todo = { content: string; status: string; priority?: string }

function Todos(props: { part: ToolPart }) {
  const todos = () =>
    ((structured(props.part).todos ?? input(props.part).todos) as Todo[] | undefined) ?? []
  const done = () => todos().filter((todo) => todo.status === "completed").length
  return (
    <div class="rounded-lg border border-line px-3.5 py-3">
      <div class="mb-2 flex items-center justify-between text-[12px]">
        <span class="font-medium text-muted">Todos</span>
        <span class="text-faint">
          {done()}/{todos().length}
        </span>
      </div>
      <div class="flex flex-col gap-1.5">
        <For each={todos()}>
          {(todo) => (
            <div class="flex items-start gap-2.5 text-[13px] leading-snug">
              <TodoMark status={todo.status} />
              <span
                classList={{
                  "text-faint line-through": todo.status === "completed" || todo.status === "cancelled",
                  "font-medium text-text": todo.status === "in_progress",
                  "text-muted": todo.status === "pending",
                }}
              >
                {todo.content}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function TodoMark(props: { status: string }) {
  return (
    <span class="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--faint)]">
      <Switch>
        <Match when={props.status === "completed"}>
          <svg viewBox="0 0 12 12" class="size-2.5 text-ok" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2.5 6.2 5 8.5l4.5-5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </Match>
        <Match when={props.status === "in_progress"}>
          <span class="size-1.5 rounded-full bg-warn" />
        </Match>
      </Switch>
    </span>
  )
}

// ---------------------------------------------------------------------------
// everything else

function summary(part: ToolPart, directory: string) {
  const value = input(part)
  switch (part.name) {
    case "apply-patch":
    case "apply_patch":
      return relative(str(value.path), directory)
    case "webfetch":
      return str(value.url)
    case "websearch":
      return str(value.query)
    case "question": {
      const questions = value.questions as { question?: string }[] | undefined
      return questions?.[0]?.question
    }
  }
  return Object.values(value).find((item): item is string => typeof item === "string")
}

function Generic(props: { part: ToolPart; directory: string }) {
  const body = () => {
    const text = texts(props.part)
    if (text) return text
    if (running(props.part)) return "Running…"
    return Object.keys(input(props.part)).length ? JSON.stringify(input(props.part), null, 2) : "No output."
  }
  // An answered question carries the picks as structured.answers: one list per question.
  const answers = () => {
    const value = structured(props.part).answers as string[][] | undefined
    return props.part.name === "question" && value?.length ? value.map((picks) => picks.join(", ")).join(" · ") : undefined
  }
  return (
    <Card
      part={props.part}
      label={LABELS[props.part.name] ?? props.part.name}
      summary={summary(props.part, props.directory)}
      meta={<Show when={answers()}>{(text) => <span class="text-text">→ {text()}</span>}</Show>}
    >
      <Output text={body()} />
    </Card>
  )
}

export function Chevron(props: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      class="size-3 shrink-0 text-faint transition-transform"
      classList={{ "rotate-90": props.open }}
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    >
      <path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}
