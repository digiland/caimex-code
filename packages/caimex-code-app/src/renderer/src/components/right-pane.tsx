import type { FitAddon, Terminal } from "ghostty-web"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { isAssistant, type Api, type FileEntry, type ToolPart } from "../api"
import type { Conversation } from "../conversations"
import { highlight } from "../highlight"
import { ToolView } from "./tools"

type Tab = "files" | "changes" | "terminal"

// Working context beside the conversation. Tabs stay mounted once opened, so a running
// terminal or an expanded folder survives switching between them.
export function RightPane(props: {
  api: Api
  directory: string
  conversation: Conversation | undefined
  onClose: () => void
}) {
  const [tab, setTab] = createSignal<Tab>("files")
  const [opened, setOpened] = createSignal<ReadonlySet<Tab>>(new Set(["files"]))
  const show = (next: Tab) => {
    setTab(next)
    if (!opened().has(next)) setOpened(new Set([...opened(), next]))
  }
  const changes = createMemo(() => changedFiles(props.conversation))

  return (
    <aside class="flex h-full w-[440px] shrink-0 flex-col border-l border-line bg-sidebar">
      <div class="drag flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-3">
        <For each={[["files", "Files"], ["changes", "Changes"], ["terminal", "Terminal"]] as const}>
          {([id, label]) => (
            <button
              onClick={() => show(id)}
              classList={{ "bg-active text-text": tab() === id, "text-muted hover:text-text": tab() !== id }}
              class="no-drag h-7 rounded-md px-2.5 text-[12.5px]"
            >
              {label}
              <Show when={id === "changes" && changes().length}>
                <span class="ml-1.5 text-[11px] text-faint">{changes().length}</span>
              </Show>
            </button>
          )}
        </For>
        <div class="flex-1" />
        <button
          onClick={props.onClose}
          title="Close (⌘\\)"
          class="no-drag flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-text"
        >
          ×
        </button>
      </div>
      <div class="relative min-h-0 flex-1">
        <div class="absolute inset-0" classList={{ hidden: tab() !== "files" }}>
          <Files api={props.api} directory={props.directory} />
        </div>
        <div class="absolute inset-0 overflow-y-auto" classList={{ hidden: tab() !== "changes" }}>
          <Changes files={changes()} directory={props.directory} />
        </div>
        <Show when={opened().has("terminal")}>
          <div class="absolute inset-0" classList={{ hidden: tab() !== "terminal" }}>
            <TerminalView api={props.api} directory={props.directory} visible={tab() === "terminal"} />
          </div>
        </Show>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Files: a lazily expanded tree and a highlighted preview of the chosen file.

function Files(props: { api: Api; directory: string }) {
  const [selected, setSelected] = createSignal<string>()
  const [preview] = createResource(selected, async (path) => {
    const text = await props.api.readFile(props.directory, path)
    const tag = path.split(".").at(-1)
    return { path, text, html: text.length < 200_000 ? await highlight(text, tag).catch(() => undefined) : undefined }
  })
  return (
    <div class="flex h-full flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto py-1.5" classList={{ "max-h-[45%]": !!selected() }}>
        <Folder api={props.api} directory={props.directory} path="" depth={0} selected={selected()} onOpen={setSelected} />
      </div>
      <Show when={selected()}>
        <div class="flex min-h-0 flex-1 flex-col border-t border-line">
          <div class="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
            <span class="min-w-0 flex-1 truncate font-mono text-muted" title={selected()}>
              {selected()}
            </span>
            <button onClick={() => setSelected(undefined)} class="text-faint hover:text-text">
              ×
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-auto px-3 pb-3 text-[11.5px]">
            <Show
              when={!preview.loading}
              fallback={<div class="text-faint">Loading…</div>}
            >
              <Show when={!preview.error} fallback={<div class="text-bad">Couldn't read this file.</div>}>
                <Show
                  when={preview()?.html}
                  fallback={<pre class="font-mono whitespace-pre text-text select-text">{preview()?.text}</pre>}
                >
                  {(html) => <div class="preview-code select-text" innerHTML={html()} />}
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

function Folder(props: {
  api: Api
  directory: string
  path: string
  depth: number
  selected: string | undefined
  onOpen: (path: string) => void
}) {
  const [entries] = createResource(
    () => props.path,
    (path) => props.api.listDir(props.directory, path.replace(/\/$/, "")),
  )
  // Folders first, then files, each alphabetical; dependency and build folders stay
  // listed but sink to the bottom.
  const sorted = createMemo(() =>
    [...(entries() ?? [])].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      return a.path.localeCompare(b.path)
    }),
  )
  return (
    <Show when={!entries.error} fallback={<div class="px-3 text-[11.5px] text-bad">Couldn't list this folder.</div>}>
      <For each={sorted()}>
        {(entry) => (
          <Entry
            api={props.api}
            directory={props.directory}
            entry={entry}
            depth={props.depth}
            selected={props.selected}
            onOpen={props.onOpen}
          />
        )}
      </For>
    </Show>
  )
}

function Entry(props: {
  api: Api
  directory: string
  entry: FileEntry
  depth: number
  selected: string | undefined
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const name = () => props.entry.path.replace(/\/$/, "").split("/").at(-1)
  const folder = () => props.entry.type === "directory"
  return (
    <>
      <button
        onClick={() => (folder() ? setOpen(!open()) : props.onOpen(props.entry.path))}
        style={{ "padding-left": `${12 + props.depth * 14}px` }}
        classList={{
          "bg-active text-text": props.selected === props.entry.path,
          "text-muted hover:bg-hover hover:text-text": props.selected !== props.entry.path,
        }}
        class="flex h-6 w-full items-center gap-1.5 pr-3 text-left text-[12.5px]"
      >
        <span class="w-3 shrink-0 text-[10px] text-faint">{folder() ? (open() ? "▾" : "▸") : ""}</span>
        <span class="truncate">{name()}</span>
      </button>
      <Show when={folder() && open()}>
        <Folder
          api={props.api}
          directory={props.directory}
          path={props.entry.path}
          depth={props.depth + 1}
          selected={props.selected}
          onOpen={props.onOpen}
        />
      </Show>
    </>
  )
}

// ---------------------------------------------------------------------------
// Changes: every file the agent edited or wrote in this session, newest change last.

type FileChanges = { path: string; parts: ToolPart[] }

function changedFiles(conversation: Conversation | undefined): FileChanges[] {
  const byPath = new Map<string, ToolPart[]>()
  for (const message of conversation?.messages ?? []) {
    if (!isAssistant(message)) continue
    for (const part of message.content) {
      if (part.type !== "tool" || (part.name !== "edit" && part.name !== "write")) continue
      if (part.state.status !== "completed") continue
      const path = typeof part.state.input?.path === "string" ? part.state.input.path : undefined
      if (!path) continue
      byPath.set(path, [...(byPath.get(path) ?? []), part])
    }
  }
  return [...byPath.entries()].map(([path, parts]) => ({ path, parts }))
}

function Changes(props: { files: FileChanges[]; directory: string }) {
  return (
    <Show
      when={props.files.length}
      fallback={<div class="px-4 py-6 text-center text-[12.5px] text-faint">No file changes in this session yet.</div>}
    >
      <div class="flex flex-col gap-4 p-3">
        <For each={props.files}>
          {(file) => (
            <section>
              <div class="mb-1.5 truncate font-mono text-[11.5px] text-muted" title={file.path}>
                {file.path}
                <Show when={file.parts.length > 1}>
                  <span class="ml-1.5 text-faint">· {file.parts.length} changes</span>
                </Show>
              </div>
              <div class="flex flex-col gap-2">
                <For each={file.parts}>{(part) => <ToolView part={part} directory={props.directory} />}</For>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Terminal: one shell in the session's folder, alive while the pane is.

let ghostty: Promise<{ mod: typeof import("ghostty-web"); instance: unknown }> | undefined
const loadGhostty = () => {
  ghostty ??= import("ghostty-web")
    .then(async (mod) => ({ mod, instance: await mod.Ghostty.load() }))
    .catch((error) => {
      ghostty = undefined
      throw error
    })
  return ghostty
}

function TerminalView(props: { api: Api; directory: string; visible: boolean }) {
  let host!: HTMLDivElement
  const [error, setError] = createSignal<string>()
  const [exited, setExited] = createSignal(false)

  onMount(() => {
    let disposed = false
    let term: Terminal | undefined
    let fit: FitAddon | undefined
    let socket: WebSocket | undefined
    let ptyID: string | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined

    const resize = () => {
      if (!term || !fit || !ptyID) return
      fit.fit()
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (ptyID) void props.api.ptyResize(props.directory, ptyID, { rows: term!.rows, cols: term!.cols })
      }, 100)
    }
    const observer = new ResizeObserver(() => props.visible && resize())

    void (async () => {
      try {
        const { mod, instance } = await loadGhostty()
        if (disposed) return
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
        const styles = getComputedStyle(document.documentElement)
        term = new mod.Terminal({
          cursorBlink: true,
          cursorStyle: "bar",
          fontSize: 12.5,
          fontFamily: styles.getPropertyValue("--code-font").trim() || "Menlo, monospace",
          scrollback: 10_000,
          theme: {
            background: styles.getPropertyValue("--sidebar").trim() || (dark ? "#19191c" : "#f3f3f1"),
            foreground: styles.getPropertyValue("--text").trim() || (dark ? "#ececef" : "#1d1d1f"),
            cursor: styles.getPropertyValue("--text").trim() || (dark ? "#ececef" : "#1d1d1f"),
          },
          ghostty: instance as never,
        })
        fit = new mod.FitAddon()
        term.loadAddon(fit)
        term.open(host)
        fit.fit()

        const pty = await props.api.ptyCreate(props.directory, { cwd: props.directory, title: "Caimex Code" })
        ptyID = pty.id
        if (disposed) return void props.api.ptyRemove(props.directory, pty.id).catch(() => {})
        socket = new WebSocket(await props.api.ptySocketUrl(props.directory, pty.id))
        socket.binaryType = "arraybuffer"
        // Text frames are terminal output; binary frames are the daemon's control channel.
        socket.onmessage = (event) => {
          if (typeof event.data === "string") term?.write(event.data)
        }
        socket.onopen = () => resize()
        socket.onclose = () => !disposed && setExited(true)
        term.onData((data) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(data)
        })
        observer.observe(host)
        term.focus()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    onCleanup(() => {
      disposed = true
      observer.disconnect()
      clearTimeout(resizeTimer)
      socket?.close()
      term?.dispose()
      if (ptyID) void props.api.ptyRemove(props.directory, ptyID).catch(() => {})
    })
  })

  return (
    <div class="flex h-full flex-col">
      <Show when={error()}>
        <div class="px-3 py-2 text-[12px] text-bad">Couldn't start a terminal: {error()}</div>
      </Show>
      <Show when={exited()}>
        <div class="px-3 py-1.5 text-[11.5px] text-faint">The shell exited. Close and reopen the pane for a new one.</div>
      </Show>
      <div ref={host} class="min-h-0 flex-1 px-2 py-1.5" />
    </div>
  )
}
