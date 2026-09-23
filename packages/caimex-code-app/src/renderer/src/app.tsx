import { createEffect, createMemo, createResource, createSignal, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createApi,
  isAssistant,
  isUser,
  type Api,
  type DaemonEvent,
  type Model,
  type ModelRef,
  type Session,
  type UserMessage,
} from "./api"
import { createAgents, type Agents } from "./agents"
import { createSuggestions, expand, isBuiltin, parseCommand } from "./commands"
import type { Draft as ComposerDraft } from "./components/composer"
import { createConversations, isBusy, type Attachment } from "./conversations"
import { modelName, projectName, sessionTitle } from "./format"
import { isChatModel } from "./models"
import { ask, ConfirmHost, notify } from "./components/confirm"
import { EmptyState } from "./components/empty-state"
import { NewSessionView } from "./components/new-session"
import { Palette, type PaletteItem } from "./components/palette"
import { RightPane } from "./components/right-pane"
import { ModelPicker, ModeSwitch, ProjectPicker } from "./components/pickers"
import { SessionView } from "./components/session-view"
import { Sidebar } from "./components/sidebar"
import { SettingsDialog } from "./components/settings-dialog"
import { Status, type Gateway } from "./components/status"
import { AgentEditor, AgentView, ModeTabs, WorkEmpty, WorkSidebar, type Mode } from "./components/work"
import { ScheduledView } from "./components/scheduled"
import { createSettings, type Settings } from "./settings"

export function App() {
  // Created before anything renders so text size applies to the splash too.
  const [settings, setSettings] = createSettings()
  // Agents live above the daemon connection: their runs keep going through a reconnect.
  const agents = createAgents()
  onMount(() => {
    const resume = () => agents.resumeAll()
    window.addEventListener("online", resume)
    onCleanup(() => window.removeEventListener("online", resume))
  })
  const [connection, { refetch: reconnect }] = createResource(() => window.caimex.connect())
  const api = createMemo(() => {
    const value = connection()
    return value?.ok ? createApi(value) : undefined
  })

  return (
    <Switch>
      <Match when={api()}>
        {(value) => (
          <Workspace
            api={value()}
            agents={agents}
            onLost={() => {
              if (!connection.loading) void reconnect()
            }}
            settings={settings}
            onSettings={(key, setting) => setSettings(key, setting)}
          />
        )}
      </Match>
      <Match when={connection.loading}>
        <Splash>Starting Caimex Code…</Splash>
      </Match>
      <Match when={connection()?.ok === false || connection.error}>
        <Splash>
          <div class="mb-2 text-text">Couldn't reach the Caimex Code daemon</div>
          <div class="mb-5 max-w-[520px] text-center break-words select-text">
            {(() => {
              const value = connection()
              return value && !value.ok ? value.error : String(connection.error)
            })()}
          </div>
          <button class="rounded-md border border-line px-3 py-1.5 text-text hover:bg-hover" onClick={reconnect}>
            Try again
          </button>
        </Splash>
      </Match>
    </Switch>
  )
}

function Splash(props: { children: JSX.Element }) {
  return (
    <div class="drag flex h-full flex-col items-center justify-center px-8 text-[13px] text-muted">
      <div class="no-drag flex flex-col items-center">{props.children}</div>
    </div>
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Sentinel selection for the new-session screen.
const NEW = "new"

type Draft = { directory?: string; model?: ModelRef; agent?: string }

function stored<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // preferences are a convenience; losing one is fine
  }
}

const ref = (model: Model | ModelRef): ModelRef => ({ id: model.id, providerID: model.providerID })

const firstLine = (text: string) => text.trim().split("\n")[0].slice(0, 80)
const untitled = (session: Session) => session.title.startsWith("New session - ")

function Workspace(props: {
  api: Api
  agents: Agents
  // The daemon stopped answering: look it up again (it may have restarted on a new port).
  onLost: () => void
  settings: Settings
  onSettings: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}) {
  const [account, { refetch: refreshAccount }] = createResource(() => props.api.integration())
  const signedIn = () => (account.latest ? account.latest.connections.length > 0 : undefined)
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [sessions, { refetch: refreshSessions }] = createResource(() => props.api.sessions())
  const [gateway, { refetch: refreshGateway }] = createResource<Gateway>(async () => {
    // A location loads lazily on the daemon; its first provider listing can come back
    // empty while that happens.
    let providers: string[] = []
    for (let attempt = 0; attempt < 4 && providers.length === 0; attempt++) {
      if (attempt) await wait(700)
      providers = (await props.api.providers()).map((provider) => provider.id)
    }
    const [models, defaultModel] = await Promise.all([
      props.api.models(),
      props.api.defaultModel().catch(() => undefined),
    ])
    return { providers, models: models.length, defaultModel }
  })

  const [catalog, { refetch: refreshCatalog }] = createResource(async () => {
    const [models, agents] = await Promise.all([props.api.models(), props.api.agents().catch(() => [])])
    return { models, agents }
  })

  const conversations = createConversations(() => props.api)
  // A reconnect swaps in a client for the (possibly relocated) daemon; reload what's shown.
  createEffect(
    on(
      () => props.api,
      () => {
        void refreshSessions()
        void refreshGateway()
        void refreshCatalog()
        void refreshAccount()
        refreshActive()
        const id = selected()
        if (id && id !== NEW) void conversations.load(id, { force: true, directory: directoryOf(id) })
      },
      { defer: true },
    ),
  )
  const [online, setOnline] = createSignal<boolean>()
  const [active, setActive] = createSignal<ReadonlySet<string>>(new Set())
  let activeTimer: ReturnType<typeof setTimeout> | undefined
  // Debounced: a burst of events should cost one request.
  const refreshActive = () => {
    clearTimeout(activeTimer)
    activeTimer = setTimeout(async () => {
      const ids = await props.api.active().catch(() => undefined)
      if (ids) setActive(new Set(ids))
    }, 250)
  }
  const markActive = (id: string) => {
    if (!active().has(id)) setActive(new Set([...active(), id]))
  }
  const [live, setLive] = createSignal(false)
  // Reopen on the last session. Storage can be unavailable; the app just starts empty.
  const remembered = (() => {
    try {
      return localStorage.getItem("caimex.selected") ?? undefined
    } catch {
      return undefined
    }
  })()
  const [selected, setSelected] = createSignal<string | undefined>(remembered)
  createEffect(
    on(selected, (id) => {
      try {
        if (id) localStorage.setItem("caimex.selected", id)
      } catch {
        // not worth surfacing
      }
    }),
  )
  const [search, setSearch] = createSignal("")

  // Model and mode per session. The list endpoint omits them, so read the session
  // itself the first time it's opened; after that, local choices lead.
  const [choices, setChoices] = createStore<Record<string, { model?: ModelRef; agent?: string }>>({})
  createEffect(
    on(selected, (id) => {
      if (!id || id === NEW || id in choices) return
      setChoices(id, {})
      void props.api
        .session(id)
        .then((detail) => setChoices(id, (current) => ({ model: detail.model, agent: detail.agent, ...current })))
        .catch(() => {})
    }),
  )
  const modelOf = (id: string) =>
    choices[id]?.model ??
    conversations.state[id]?.messages.filter(isAssistant).at(-1)?.model ??
    gateway.latest?.defaultModel
  const chooseModel = async (id: string, model: Model) => {
    const previous = choices[id]?.model
    setChoices(id, "model", ref(model))
    try {
      await props.api.setModel(id, ref(model))
    } catch (error) {
      setChoices(id, "model", previous)
      throw error
    }
  }
  const chooseAgent = async (id: string, agent: string) => {
    const previous = choices[id]?.agent
    setChoices(id, "agent", agent)
    try {
      await props.api.setAgent(id, agent)
    } catch (error) {
      setChoices(id, "agent", previous)
      throw error
    }
  }

  // What a new session starts with: the last project, model and mode used.
  const [draft, setDraft] = createStore<Draft>(stored<Draft>("caimex.draft") ?? {})
  createEffect(() => store("caimex.draft", { ...draft }))
  // Most recent first, skipping folders that have since been deleted.
  const [recentProjects] = createResource(
    () => sessions.latest,
    async (list) => {
      const seen = new Set<string>()
      for (const item of [...list].sort((a, b) => b.time.updated - a.time.updated)) seen.add(item.location.directory)
      const present = await Promise.all([...seen].map(async (directory) => ((await window.caimex.exists(directory)) ? directory : undefined)))
      return present.filter((directory): directory is string => !!directory).slice(0, 8)
    },
  )

  const { commands, suggest } = createSuggestions(() => props.api)

  // Turns what was typed into the prompt to send: app commands run here and send
  // nothing (undefined); project commands expand their template.
  async function prepare(text: string, directory: string | undefined, sessionID?: string) {
    const command = parseCommand(text)
    if (!command) return text
    if (isBuiltin(command.name)) {
      if (command.name === "new") setSelected(NEW)
      else if (command.name === "settings") setSettingsOpen(true)
      else if (sessionID) await chooseAgent(sessionID, command.name)
      else setDraft("agent", command.name)
      return undefined
    }
    const found = directory ? (await commands(directory)).find((item) => item.name === command.name) : undefined
    if (!found) throw new Error(`There's no /${command.name} command in this project.`)
    return expand(found.template, command.args)
  }

  // Rewind hands the removed message back to the composer, per session.
  const [drafts, setDrafts] = createStore<Record<string, ComposerDraft>>({})
  let nonce = 0
  async function rewind(sessionID: string, message: UserMessage) {
    const messages = conversations.state[sessionID]?.messages ?? []
    const previous = messages[messages.findIndex((item) => item.id === message.id) - 1]
    if (!previous) return
    const confirmed = await ask({
      message: "Rewind to before this message?",
      detail:
        "This message and everything after it leave the conversation, and its text goes back in the composer to edit. Files the agent changed stay as they are.",
      confirm: "Rewind",
    })
    if (!confirmed) return
    // Rewinding keeps the message it's staged at and drops what follows, so stage at the
    // one before.
    await props.api.stageRewind(sessionID, previous.id)
    try {
      await props.api.commitRewind(sessionID)
    } catch (error) {
      await props.api.clearRewind(sessionID).catch(() => {})
      throw error
    }
    await conversations.load(sessionID, { force: true, directory: directoryOf(sessionID) })
    setDrafts(sessionID, { text: message.text, nonce: ++nonce })
  }

  const rewindButton = (sessionID: string) => (message: UserMessage, index: number) => (
    <Show when={index > 0 && !isBusy(conversations.state[sessionID], active().has(sessionID))}>
      <button
        title="Rewind to before this message"
        onClick={() => void reportFailure("Couldn't rewind", () => rewind(sessionID, message))}
        class="flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-text"
      >
        <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </Show>
  )

  const contextLimitOf = (id: string) => {
    const model = modelOf(id)
    return catalog.latest?.models.find((item) => item.id === model?.id && item.providerID === model.providerID)?.limit?.context
  }

  const [paletteOpen, setPaletteOpen] = createSignal(false)

  // Code (sessions on the daemon) or Work (Hermes agents).
  const [mode, setMode] = createSignal<Mode>(stored<Mode>("caimex.mode") ?? "code")
  createEffect(() => store("caimex.mode", mode()))
  const [agent, pickAgent] = createSignal<string | undefined>(stored<string>("caimex.agent"))
  createEffect(() => store("caimex.agent", agent()))
  // Work shows an agent's conversation or the Scheduled tasks view.
  const [scheduled, setScheduled] = createSignal(stored<boolean>("caimex.scheduled") ?? false)
  createEffect(() => store("caimex.scheduled", scheduled()))
  const setAgent = (id: string | undefined) => {
    setScheduled(false)
    pickAgent(id)
  }
  const shownAgent = () => {
    const id = agent()
    return id && props.agents.profileOf(id) ? id : props.agents.sorted()[0]?.id
  }
  // undefined: closed; null: adding; an id: editing that agent.
  const [editing, setEditing] = createSignal<string | null>()
  const attention = () =>
    props.agents.state.profiles.filter((profile) => props.agents.state.live[profile.id]?.presence === "needsYou").length
  const tabs = () => <ModeTabs mode={mode()} onMode={setMode} attention={attention()} />
  const [renameRequest, setRenameRequest] = createSignal<{ id: string; nonce: number }>()

  const paletteItems = (): PaletteItem[] => {
    const id = selected()
    const current = id && id !== NEW ? session() : undefined
    const items: PaletteItem[] = [
      {
        id: "new",
        group: "Actions",
        label: "New session",
        shortcut: "⌘N",
        run: () => {
          setMode("code")
          setSelected(NEW)
        },
      },
      {
        id: "mode",
        group: "Actions",
        label: mode() === "code" ? "Go to Work (agents)" : "Go to Code (sessions)",
        shortcut: mode() === "code" ? "⌘2" : "⌘1",
        run: () => setMode(mode() === "code" ? "work" : "code"),
      },
      { id: "add-agent", group: "Actions", label: "Add an agent…", run: () => setEditing(null) },
      {
        id: "scheduled",
        group: "Actions",
        label: "Scheduled tasks",
        detail: "agents' recurring jobs",
        run: () => {
          setMode("work")
          setScheduled(true)
        },
      },
      { id: "settings", group: "Actions", label: "Settings", shortcut: "⌘,", run: () => setSettingsOpen(true) },
    ]
    if (current) {
      items.push(
        {
          id: "pane",
          group: "Actions",
          label: paneOpen() ? "Hide files, changes and terminal" : "Show files, changes and terminal",
          shortcut: "⌘\\",
          run: () => setPaneOpen(!paneOpen()),
        },
        {
          id: "rename",
          group: "Actions",
          label: "Rename this session",
          run: () => setRenameRequest({ id: current.id, nonce: ++nonce }),
        },
        {
          id: "delete",
          group: "Actions",
          label: "Delete this session…",
          run: () => void reportFailure("Couldn't delete the session", () => deleteSession(current)),
        },
      )
    }
    for (const mode of ["plan", "build"] as const)
      items.push({
        id: `mode-${mode}`,
        group: "Actions",
        label: mode === "plan" ? "Switch to Plan mode" : "Switch to Build mode",
        detail: mode === "plan" ? "no edits" : undefined,
        run: () =>
          current
            ? void reportFailure("Couldn't switch mode", () => chooseAgent(current.id, mode))
            : setDraft("agent", mode),
      })
    for (const item of [...(sessions.latest ?? [])].sort((a, b) => b.time.updated - a.time.updated))
      items.push({
        id: `session-${item.id}`,
        group: "Sessions",
        label: titleOf(item),
        detail: projectName(item.location.directory),
        run: () => {
          setMode("code")
          setSelected(item.id)
        },
      })
    for (const profile of props.agents.sorted())
      items.push({
        id: `agent-${profile.id}`,
        group: "Agents",
        label: `${profile.emoji} ${profile.name}`,
        detail: props.agents.state.live[profile.id]?.presence === "needsYou" ? "needs you" : profile.profile,
        run: () => {
          setMode("work")
          setAgent(profile.id)
        },
      })
    for (const model of (catalog.latest?.models ?? []).filter(isChatModel))
      items.push({
        id: `model-${model.id}`,
        group: "Models",
        label: modelName(model.id),
        detail: current ? "use in this session" : "use for new sessions",
        run: () =>
          current
            ? void reportFailure("Couldn't switch model", () => chooseModel(current.id, model))
            : void setDraft("model", ref(model)),
      })
    return items
  }

  const [paneOpen, setPaneOpen] = createSignal(stored<boolean>("caimex.pane") ?? false)
  createEffect(() => store("caimex.pane", paneOpen()))

  async function startSession(input: string, files: Attachment[]) {
    const directory = draft.directory
    const text = await prepare(input, directory)
    if (text === undefined) return
    if (!directory) throw new Error("Choose a project folder first.")
    if (!(await window.caimex.exists(directory))) throw new Error(`That folder no longer exists: ${directory}`)
    const model = draft.model ?? (gateway.latest?.defaultModel && ref(gateway.latest.defaultModel))
    const created = await props.api.createSession({ directory, model, agent: draft.agent })
    setTitles(created.id, firstLine(text))
    setChoices(created.id, { model: created.model ?? model, agent: created.agent ?? draft.agent })
    await refreshSessions()
    await conversations.load(created.id, { directory })
    setSelected(created.id)
    markActive(created.id)
    await conversations.send(created.id, text, { files, fresh: { directory } })
  }

  const controls = (input: {
    model: () => ModelRef | undefined
    agent: () => string | undefined
    onModel: (model: Model) => void | Promise<void>
    onAgent: (agent: string) => void | Promise<void>
  }) => (
    <>
      <ModelPicker models={catalog.latest?.models ?? []} value={input.model()} onChange={input.onModel} />
      <ModeSwitch agents={catalog.latest?.agents ?? []} value={input.agent()} onChange={input.onAgent} />
    </>
  )
  const session = createMemo(() => sessions.latest?.find((item) => item.id === selected()))

  // The dev daemon never titles sessions, so name untitled ones by their first prompt.
  const [titles, setTitles] = createStore<Record<string, string>>({})
  // A real title always wins; the first-prompt name only stands in for an untitled one.
  const titleOf = (session: Session) =>
    untitled(session) ? titles[session.id] || sessionTitle(session) : session.title
  createEffect(
    on(
      () => sessions.latest,
      async (list) => {
        const missing = (list ?? []).filter((item) => untitled(item) && !(item.id in titles))
        for (const item of missing) setTitles(item.id, "")
        for (let i = 0; i < missing.length; i += 6)
          await Promise.all(
            missing.slice(i, i + 6).map(async (item) => {
              // A session whose folder is gone makes the daemon 500; don't ask.
              if (!(await window.caimex.exists(item.location.directory))) return
              const first = await props.api.firstMessage(item.id).catch(() => undefined)
              if (first && isUser(first)) setTitles(item.id, firstLine(first.text))
            }),
          )
      },
    ),
  )

  const directoryOf = (id: string) => sessions.latest?.find((item) => item.id === id)?.location.directory
  createEffect(
    on([selected, () => sessions.latest] as const, ([id, list]) => {
      if (id && id !== NEW && list) void conversations.load(id, { directory: directoryOf(id) })
    }),
  )

  // Events after which a run may have started or finished.
  const RUN_EDGES = new Set([
    "session.next.step.ended",
    "session.next.step.failed",
    "session.next.tool.failed",
    "permission.v2.replied",
    "question.v2.replied",
    "question.v2.rejected",
  ])

  async function renameSession(id: string, title: string) {
    await props.api.rename(id, title)
    await refreshSessions()
  }

  async function deleteSession(target: Session) {
    const confirmed = await ask({
      message: `Delete “${titleOf(target)}”?`,
      detail: "This permanently removes the session and its history. It can't be undone.",
      confirm: "Delete",
      danger: true,
    })
    if (!confirmed) return
    await props.api.remove(target.id)
    dropSession(target.id)
    await refreshSessions()
  }

  async function reportFailure(message: string, action: () => Promise<void>) {
    try {
      await action()
    } catch (error) {
      await notify({ message, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  function dropSession(id: string) {
    if (selected() === id) setSelected(undefined)
    conversations.forget(id)
  }

  // Other clients (the CLI, the other desktop app) rename and delete too.
  let listTimer: ReturnType<typeof setTimeout> | undefined
  const refreshListSoon = () => {
    clearTimeout(listTimer)
    listTimer = setTimeout(() => void refreshSessions(), 200)
  }

  function handle(event: DaemonEvent) {
    conversations.apply(event)
    // A rewind removes messages, which the event reducer can't express; reload instead.
    if (event.type === "session.next.revert.committed" && event.data.sessionID) {
      const id = event.data.sessionID
      if (conversations.state[id]) void conversations.load(id, { force: true, directory: directoryOf(id) })
    }
    if (event.type === "session.created" || event.type === "session.deleted" || event.type === "session.updated") {
      if (event.type === "session.deleted" && event.data.sessionID) dropSession(event.data.sessionID)
      refreshListSoon()
      return
    }
    const sessionID = event.data.sessionID
    if (sessionID && (event.type === "session.next.prompted" || event.type === "session.next.step.started"))
      markActive(sessionID)
    if (event.type === "session.next.prompted" || RUN_EDGES.has(event.type)) refreshActive()
    if (event.type !== "session.next.prompted") return
    const id = event.data.sessionID
    const text = (event.data.prompt as { text?: string } | undefined)?.text
    if (!id) return
    const known = sessions.latest?.find((item) => item.id === id)
    if (!known) void refreshSessions()
    if (text && !titles[id] && (!known || untitled(known))) setTitles(id, firstLine(text))
  }

  onMount(() => {
    let failures = 0
    const check = async () => {
      const healthy = await props.api
        .health()
        .then((value) => value.healthy)
        .catch(() => false)
      if (healthy && online() === false) void refreshSessions()
      setOnline(healthy)
      if (healthy) refreshActive()
      failures = healthy ? 0 : failures + 1
      if (failures >= 2) {
        failures = 0
        props.onLost()
      }
    }
    void check()
    const timer = setInterval(check, 5000)
    // Sessions started elsewhere (the CLI, the other desktop app) show up on return.
    const onFocus = () => void refreshSessions()
    window.addEventListener("focus", onFocus)
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === "1" || event.key === "2") {
        event.preventDefault()
        setMode(event.key === "1" ? "code" : "work")
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault()
        setMode("code")
        setSelected(NEW)
      } else if (event.key === ",") {
        event.preventDefault()
        setSettingsOpen(true)
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen(!paletteOpen())
      } else if (event.key === "\\") {
        event.preventDefault()
        setPaneOpen(!paneOpen())
      }
    }
    window.addEventListener("keydown", onKey)

    // Live updates, reconnecting with backoff. After a gap, reload what is on screen:
    // events missed while disconnected are gone for good.
    const abort = new AbortController()
    void (async () => {
      let delay = 1000
      let connected = false
      while (!abort.signal.aborted) {
        try {
          let opened = false
          for await (const event of props.api.events(abort.signal)) {
            if (!opened) {
              opened = true
              setLive(true)
              delay = 1000
              refreshActive()
              if (connected) {
                void refreshSessions()
                const id = selected()
                if (id) void conversations.load(id, { force: true, directory: directoryOf(id) })
              }
              connected = true
            }
            handle(event)
          }
        } catch {
          if (abort.signal.aborted) return
        }
        setLive(false)
        await wait(delay)
        delay = Math.min(delay * 2, 10_000)
      }
    })()

    onCleanup(() => {
      clearInterval(timer)
      clearTimeout(activeTimer)
      clearTimeout(listTimer)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("keydown", onKey)
      abort.abort()
    })
  })

  const footer = () => (
      <div class="flex items-center gap-1">
        <button
          onClick={() => setSettingsOpen(true)}
          class="min-w-0 flex-1 rounded-md py-1 text-left hover:bg-hover"
          title="Settings (⌘,)"
        >
          <Status
            online={online()}
            live={live()}
            signedIn={signedIn()}
            gateway={gateway.latest}
            error={gateway.error ? String(gateway.error.message ?? gateway.error) : undefined}
          />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          title="Settings (⌘,)"
          class="flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-text"
        >
          <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>
  )

  return (
    <div class="flex h-full">
      <div classList={{ hidden: mode() !== "code" }} class="h-full">
        <Sidebar
          sessions={sessions.latest}
          loading={sessions.loading}
          error={sessions.error ? String(sessions.error.message ?? sessions.error) : undefined}
          selected={selected()}
          search={search()}
          onSearch={setSearch}
          onSelect={setSelected}
          onRefresh={refreshSessions}
          onNew={() => setSelected(NEW)}
          creating={selected() === NEW}
          titleOf={titleOf}
          renameRequest={renameRequest()}
          onRename={(id, title) => reportFailure("Couldn't rename the session", () => renameSession(id, title))}
          onDelete={(target) => reportFailure("Couldn't delete the session", () => deleteSession(target))}
          busy={(id) => isBusy(conversations.state[id], active().has(id))}
          tabs={tabs()}
          footer={footer()}
        />
      </div>
      <div classList={{ hidden: mode() !== "work" }} class="h-full">
        <WorkSidebar
          agents={props.agents}
          selected={shownAgent()}
          onSelect={setAgent}
          onAdd={() => setEditing(null)}
          scheduled={scheduled() && props.agents.state.profiles.length > 0}
          onScheduled={() => setScheduled(true)}
          tabs={tabs()}
          footer={footer()}
        />
      </div>
      <main classList={{ hidden: mode() !== "work" }} class="min-w-0 flex-1">
        <Show when={!(scheduled() && props.agents.state.profiles.length)} fallback={<ScheduledView agents={props.agents} />}>
        <Show
          when={shownAgent()}
          keyed
          fallback={<WorkEmpty agents={props.agents} onAdd={() => setEditing(null)} onCreated={setAgent} />}
        >
          {(id) => <AgentView agents={props.agents} id={id} onEdit={() => setEditing(id)} />}
        </Show>
        </Show>
      </main>
      <main classList={{ hidden: mode() !== "code" }} class="min-w-0 flex-1">
        {/* Keyed on the id, not the session object, so refreshing the list doesn't
            remount the view and throw away scroll position or a half-typed message. */}
        <Show
          when={selected()}
          keyed
          fallback={
            <div class="flex h-full flex-col">
              <div class="drag h-[52px] shrink-0" />
              <div class="min-h-0 flex-1">
                <EmptyState />
              </div>
            </div>
          }
        >
          {(id) => (
            <Show
              when={id !== NEW}
              fallback={
                <NewSessionView
                  onSend={startSession}
                  suggest={suggest(draft.directory)}
                  project={
                    <ProjectPicker
                      recent={recentProjects.latest ?? []}
                      value={draft.directory}
                      onChange={(directory) => setDraft("directory", directory)}
                    />
                  }
                  controls={controls({
                    model: () => draft.model ?? (gateway.latest?.defaultModel && ref(gateway.latest.defaultModel)),
                    agent: () => draft.agent,
                    onModel: (model) => void setDraft("model", ref(model)),
                    onAgent: (agent) => void setDraft("agent", agent),
                  })}
                />
              }
            >
            <Show when={session()}>
              {(value) => (
                <div class="flex h-full">
                <div class="min-w-0 flex-1">
                <SessionView
                  session={value()}
                  title={titleOf(value())}
                  conversation={conversations.state[id]}
                  running={active().has(id)}
                  controls={controls({
                    model: () => modelOf(id),
                    agent: () => choices[id]?.agent,
                    onModel: (model) => chooseModel(id, model),
                    onAgent: (agent) => chooseAgent(id, agent),
                  })}
                  contextLimit={contextLimitOf(id)}
                  draft={drafts[id]}
                  paneOpen={paneOpen()}
                  onTogglePane={() => setPaneOpen(!paneOpen())}
                  suggest={suggest(value().location.directory)}
                  userActions={rewindButton(id)}
                  onRetry={() => void conversations.load(id, { force: true, directory: value().location.directory })}
                  onRetrySend={() =>
                    void reportFailure("Couldn't resend the message", () => conversations.retry(id))
                  }
                  onSend={async (input, files) => {
                    const text = await prepare(input, value().location.directory, id)
                    if (text !== undefined) await conversations.send(id, text, { files })
                  }}
                  onStop={async () => {
                    await props.api.interrupt(id)
                    refreshActive()
                  }}
                  onAnswer={async (requestID, answers) => {
                    await props.api.answer(id, requestID, answers)
                    conversations.settle(id, "questions", requestID)
                  }}
                  onDismiss={async (requestID) => {
                    await props.api.dismiss(id, requestID)
                    conversations.settle(id, "questions", requestID)
                  }}
                  onDecide={async (requestID, reply) => {
                    await props.api.decide(id, requestID, reply)
                    conversations.settle(id, "permissions", requestID)
                  }}
                />
                </div>
                <Show when={paneOpen()}>
                  <RightPane
                    api={props.api}
                    directory={value().location.directory}
                    conversation={conversations.state[id]}
                    onClose={() => setPaneOpen(false)}
                  />
                </Show>
                </div>
              )}
            </Show>
            </Show>
          )}
        </Show>
      </main>
      <Show when={paletteOpen()}>
        <Palette items={paletteItems()} onClose={() => setPaletteOpen(false)} />
      </Show>
      <Show when={editing() !== undefined}>
        <AgentEditor
          agents={props.agents}
          profile={editing() ? props.agents.profileOf(editing()!) : undefined}
          onClose={() => setEditing(undefined)}
          onSaved={(id) => {
            setMode("work")
            setAgent(id)
          }}
          onRemoved={(id) => agent() === id && setAgent(undefined)}
        />
      </Show>
      <ConfirmHost />
      <Show when={settingsOpen()}>
        <SettingsDialog
          api={props.api}
          settings={props.settings}
          onSettings={props.onSettings}
          onAccountChanged={() => void refreshAccount()}
          onClose={() => setSettingsOpen(false)}
        />
      </Show>
    </div>
  )
}
