import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { Session } from "../api"
import { projectName, relativeTime } from "../format"

type Group = { directory: string; sessions: Session[]; updated: number }

export function Sidebar(props: {
  sessions: Session[] | undefined
  loading: boolean
  error: string | undefined
  selected: string | undefined
  search: string
  onSearch: (value: string) => void
  onSelect: (id: string) => void
  onRefresh: () => void
  footer?: JSX.Element
  // The Code/Work switch.
  tabs?: JSX.Element
  titleOf: (session: Session) => string
  onNew: () => void
  creating: boolean
  busy: (id: string) => boolean
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (session: Session) => Promise<void>
  // Starts an inline rename from elsewhere (the command palette).
  renameRequest?: { id: string; nonce: number }
}) {
  const [menu, setMenu] = createSignal<string>()
  const [renaming, setRenaming] = createSignal<string>()
  createEffect(
    on(
      () => props.renameRequest?.nonce,
      () => props.renameRequest && setRenaming(props.renameRequest.id),
      { defer: true },
    ),
  )
  const groups = createMemo<Group[]>(() => {
    const query = props.search.trim().toLowerCase()
    const byDirectory = new Map<string, Session[]>()
    for (const session of props.sessions ?? []) {
      if (query && !`${props.titleOf(session)} ${session.location.directory}`.toLowerCase().includes(query)) continue
      const list = byDirectory.get(session.location.directory) ?? []
      list.push(session)
      byDirectory.set(session.location.directory, list)
    }
    return [...byDirectory.entries()]
      .map(([directory, sessions]) => {
        sessions.sort((a, b) => b.time.updated - a.time.updated)
        return { directory, sessions, updated: sessions[0].time.updated }
      })
      .sort((a, b) => b.updated - a.updated)
  })

  return (
    <aside class="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-sidebar">
      {/* space for the macOS traffic lights; the whole strip drags the window */}
      <div class="drag h-[52px] shrink-0" />
      {props.tabs}

      <div class="flex flex-col gap-2 px-3 pb-3">
        <button
          onClick={props.onNew}
          title="New session (⌘N)"
          classList={{ "bg-active text-text": props.creating, "text-muted": !props.creating }}
          class="no-drag flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-[13px] hover:bg-hover hover:text-text"
        >
          <span class="text-base leading-none">+</span> New session
        </button>
        <input
          value={props.search}
          onInput={(event) => props.onSearch(event.currentTarget.value)}
          placeholder="Search sessions"
          class="no-drag h-8 rounded-md border border-line bg-bg px-2.5 text-[13px] text-text outline-none placeholder:text-faint focus:border-[var(--muted)]"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Show when={props.error}>
          <div class="mx-1 rounded-md border border-line p-3 text-[12px] text-muted">
            <div class="mb-2 text-bad">Couldn't load sessions</div>
            <div class="mb-3 break-words select-text">{props.error}</div>
            <button class="text-text underline" onClick={props.onRefresh}>
              Try again
            </button>
          </div>
        </Show>
        <Show when={props.loading && !props.sessions}>
          <div class="px-2 py-3 text-[12px] text-faint">Loading sessions…</div>
        </Show>
        <Show when={props.sessions && groups().length === 0}>
          <div class="px-2 py-3 text-[12px] text-faint">
            {props.search ? "No sessions match." : "No sessions yet."}
          </div>
        </Show>
        <For each={groups()}>
          {(group) => (
            <section class="mb-3">
              <div title={group.directory} class="truncate px-2 pb-1 pt-2 text-[11px] font-medium text-faint">
                {projectName(group.directory)}
              </div>
              <For each={group.sessions}>
                {(session) => (
                  <Show
                    when={renaming() !== session.id}
                    fallback={
                      <RenameField
                        initial={props.titleOf(session)}
                        onDone={async (title) => {
                          setRenaming(undefined)
                          if (title && title !== props.titleOf(session)) await props.onRename(session.id, title)
                        }}
                      />
                    }
                  >
                    <div class="group relative">
                      <button
                        onClick={() => props.onSelect(session.id)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setMenu(session.id)
                        }}
                        classList={{
                          "bg-active text-text": props.selected === session.id,
                          "text-muted hover:bg-hover hover:text-text": props.selected !== session.id,
                        }}
                        class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]"
                      >
                        <span class="min-w-0 flex-1 truncate">{props.titleOf(session)}</span>
                        <Show
                          when={props.busy(session.id)}
                          fallback={
                            <span class="shrink-0 text-[11px] text-faint group-hover:invisible">
                              {relativeTime(session.time.updated)}
                            </span>
                          }
                        >
                          <span title="Working" class="mr-1 size-1.5 shrink-0 animate-pulse rounded-full bg-warn group-hover:invisible" />
                        </Show>
                      </button>
                      <button
                        title="More"
                        onClick={() => setMenu(menu() === session.id ? undefined : session.id)}
                        classList={{ visible: menu() === session.id, invisible: menu() !== session.id }}
                        class="absolute top-1 right-1 flex size-6 items-center justify-center rounded text-muted group-hover:visible hover:bg-active hover:text-text"
                      >
                        <svg viewBox="0 0 16 16" class="size-3.5" fill="currentColor">
                          <circle cx="3.5" cy="8" r="1.3" />
                          <circle cx="8" cy="8" r="1.3" />
                          <circle cx="12.5" cy="8" r="1.3" />
                        </svg>
                      </button>
                      <Show when={menu() === session.id}>
                        <Menu onClose={() => setMenu(undefined)}>
                          <MenuItem
                            onClick={() => {
                              setMenu(undefined)
                              setRenaming(session.id)
                            }}
                          >
                            Rename
                          </MenuItem>
                          <MenuItem
                            danger
                            onClick={() => {
                              setMenu(undefined)
                              void props.onDelete(session)
                            }}
                          >
                            Delete…
                          </MenuItem>
                        </Menu>
                      </Show>
                    </div>
                  </Show>
                )}
              </For>
            </section>
          )}
        </For>
      </div>

      <div class="shrink-0 border-t border-line px-3 py-3">{props.footer}</div>
    </aside>
  )
}

function RenameField(props: { initial: string; onDone: (title: string | undefined) => void }) {
  let done = false
  const finish = (value: string | undefined) => {
    if (done) return
    done = true
    props.onDone(value?.trim() || undefined)
  }
  return (
    <input
      ref={(element) =>
        queueMicrotask(() => {
          element.focus()
          element.select()
        })
      }
      value={props.initial}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value)
        if (event.key === "Escape") finish(undefined)
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      class="h-8 w-full rounded-md border border-[var(--muted)] bg-bg px-2 text-[13px] text-text outline-none"
    />
  )
}

function Menu(props: { onClose: () => void; children: JSX.Element }) {
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
      class="absolute top-full right-1 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-[0_8px_30px_rgb(0_0_0/0.25)]"
    >
      {props.children}
    </div>
  )
}

function MenuItem(props: { onClick: () => void; danger?: boolean; children: JSX.Element }) {
  return (
    <button
      onClick={props.onClick}
      classList={{ "text-bad": props.danger, "text-text": !props.danger }}
      class="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover"
    >
      {props.children}
    </button>
  )
}
