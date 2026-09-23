import { createEffect, createMemo, createResource, createSignal, For, type JSX, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { newProfile, preview, type AgentItem, type AgentProfile, type Agents, type ApprovalPolicy } from "../agents"
import { hermes } from "../hermes"
import { relativeTime } from "../format"
import { Composer } from "./composer"
import { ask } from "./confirm"
import { Markdown } from "./markdown"
import { UserBubble } from "./messages"

// The Work tab: Hermes agents for work beyond code (research, inbox, reports…), each
// with its own conversation, approvals and questions. Everything goes through
// ../agents, which follows runs the same way the mobile apps do.

export type Mode = "code" | "work"

export function ModeTabs(props: { mode: Mode; onMode: (mode: Mode) => void; attention: number }) {
  const tab = (mode: Mode, label: string, shortcut: string) => (
    <button
      onClick={() => props.onMode(mode)}
      title={`${label} (${shortcut})`}
      classList={{ "bg-elevated text-text shadow-[0_1px_3px_rgb(0_0_0/0.15)]": props.mode === mode, "text-muted hover:text-text": props.mode !== mode }}
      class="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[12.5px]"
    >
      {label}
      <Show when={mode === "work" && props.attention > 0}>
        <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-medium text-black">
          {props.attention}
        </span>
      </Show>
    </button>
  )
  return (
    <div class="no-drag mx-3 mb-3 flex gap-1 rounded-lg bg-active p-0.5">
      {tab("code", "Code", "⌘1")}
      {tab("work", "Work", "⌘2")}
    </div>
  )
}

function Avatar(props: { profile: AgentProfile; size?: "sm" | "lg" }) {
  return (
    <span
      style={{ background: `${props.profile.color}26`, color: props.profile.color }}
      classList={{ "size-7 text-[14px]": props.size !== "lg", "size-10 text-[20px]": props.size === "lg" }}
      class="flex shrink-0 items-center justify-center rounded-full"
    >
      {props.profile.emoji}
    </span>
  )
}

export function WorkSidebar(props: {
  agents: Agents
  selected: string | undefined
  onSelect: (id: string) => void
  onAdd: () => void
  tabs: JSX.Element
  footer: JSX.Element
}) {
  const state = () => props.agents.state
  return (
    <aside class="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div class="drag h-[52px] shrink-0" />
      {props.tabs}
      <div class="px-3 pb-3">
        <button
          onClick={props.onAdd}
          class="no-drag flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-muted hover:bg-hover hover:text-text"
        >
          <span class="text-base leading-none">+</span> Add agent
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Show when={state().profiles.length === 0}>
          <div class="px-2 py-3 text-[12px] text-faint">No agents yet.</div>
        </Show>
        <For each={props.agents.sorted()}>
          {(profile) => {
            const live = () => state().live[profile.id]
            const thread = () => state().threads[profile.id]
            return (
              <button
                onClick={() => props.onSelect(profile.id)}
                classList={{
                  "bg-active": props.selected === profile.id,
                  "hover:bg-hover": props.selected !== profile.id,
                }}
                class="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left"
              >
                <Avatar profile={profile} />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <span class="min-w-0 flex-1 truncate text-[13px] text-text">
                      {profile.pinned ? "📌 " : ""}
                      {profile.name}
                    </span>
                    <Switch
                      fallback={
                        <Show when={thread()?.items.length}>
                          <span class="shrink-0 text-[11px] text-faint">{relativeTime(thread()!.updated)}</span>
                        </Show>
                      }
                    >
                      <Match when={live()?.presence === "needsYou"}>
                        <span class="shrink-0 rounded-full bg-warn/20 px-1.5 text-[10.5px] text-warn">Needs you</span>
                      </Match>
                      <Match when={live()?.presence === "working"}>
                        <span title="Working" class="mr-1 size-1.5 shrink-0 animate-pulse rounded-full bg-warn" />
                      </Match>
                      <Match when={live()?.unread}>
                        <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-text px-1 text-[10px] font-medium text-bg">
                          {live()?.unread}
                        </span>
                      </Match>
                    </Switch>
                  </span>
                  <span class="block truncate text-[11.5px] text-faint">{preview(thread()) ?? subtitle(profile)}</span>
                </span>
              </button>
            )
          }}
        </For>
      </div>
      <div class="shrink-0 border-t border-line px-3 py-3">{props.footer}</div>
    </aside>
  )
}

const subtitle = (profile: AgentProfile) => (profile.profile ? `Hermes · ${profile.profile}` : "Hermes")

// ---- empty state ------------------------------------------------------------------

export function WorkEmpty(props: { agents: Agents; onAdd: () => void; onCreated: (id: string) => void }) {
  const [local] = createResource(() => window.caimex.hermes.local())
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  // One agent for the default profile and one per multiplexed profile, all using this
  // Mac's Hermes key (copied in the main process, never shown here).
  const connectLocal = async () => {
    const found = local()
    if (!found?.found) return
    setBusy(true)
    setError(undefined)
    try {
      const probe = newProfile({ name: "Hermes", baseURL: found.baseURL, emoji: "☤", color: "#14E0A1" })
      if (!(await window.caimex.hermes.useLocalKey(probe.id))) throw new Error("This Mac's Hermes has no API_SERVER_KEY set.")
      const created = [probe, ...found.profiles.map((name) => newProfile({ name: title(name), baseURL: found.baseURL, profile: name }))]
      for (const profile of created.slice(1)) await window.caimex.hermes.useLocalKey(profile.id)
      await hermes.health({ id: probe.id, baseURL: probe.baseURL })
      for (const profile of created) props.agents.add(profile)
      props.onCreated(probe.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex h-full flex-col">
      <div class="drag h-[52px] shrink-0" />
      <div class="flex min-h-0 flex-1 items-center justify-center px-8">
        <div class="max-w-[440px] text-center">
          <div class="mb-3 text-[28px]">☤</div>
          <div class="mb-2 text-[17px] font-medium text-text">Work with agents</div>
          <div class="mb-6 text-[13px] leading-relaxed text-muted">
            Hermes agents handle work beyond code: research, reports, inbox and follow-ups. They ask before acting,
            and runs keep going while you're elsewhere in the app.
          </div>
          <div class="flex flex-col items-center gap-2">
            <Show when={(() => { const value = local(); return value?.found ? value : undefined })()}>
              {(found) => (
                <button
                  disabled={busy()}
                  onClick={() => void connectLocal()}
                  class="h-9 rounded-md bg-text px-4 text-[13px] font-medium text-bg disabled:opacity-50"
                >
                  {busy()
                    ? "Connecting…"
                    : `Connect this Mac's Hermes${found().profiles.length ? ` (${found().profiles.length + 1} agents)` : ""}`}
                </button>
              )}
            </Show>
            <button onClick={props.onAdd} class="h-9 rounded-md px-4 text-[13px] text-muted hover:bg-hover hover:text-text">
              Add an agent by address…
            </button>
            <Show when={error()}>
              <div class="mt-2 text-[12px] text-bad select-text">{error()}</div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

const title = (name: string) => name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())

// ---- one agent --------------------------------------------------------------------

export function AgentView(props: { agents: Agents; id: string; onEdit: () => void }) {
  const profile = () => props.agents.profileOf(props.id)
  const thread = () => props.agents.state.threads[props.id]
  const live = () => props.agents.state.live[props.id]
  const [health, { refetch }] = createResource(
    () => props.agents.target(props.id),
    (target) => hermes.health(target).catch((error: Error) => ({ status: "error", error: error.message }) as const),
  )
  const reachable = () => health.latest?.status === "ok"

  let scroller!: HTMLDivElement
  let pinned = true
  const onScroll = () => (pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80)
  createEffect(
    on(
      () => [thread()?.items.length, thread()?.items.at(-1)] as const,
      () => queueMicrotask(() => pinned && (scroller.scrollTop = scroller.scrollHeight)),
    ),
  )
  onMount(() => {
    scroller.scrollTop = scroller.scrollHeight
    props.agents.markRead(props.id)
    onCleanup(() => props.agents.setVisible(undefined))
  })

  const [draft, setDraft] = createSignal<{ text: string; nonce: number }>()
  let nonce = 0

  const pending = () => thread()?.items.find((item) => item.id === live()?.pending)

  return (
    <Show when={profile()}>
      {(agent) => (
        <div class="flex h-full flex-col">
          <header class="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-6">
            <Avatar profile={agent()} />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] font-medium">{agent().name}</div>
              <div class="truncate text-[10.5px] text-faint">
                <Switch fallback={<span>{subtitle(agent())} · checking…</span>}>
                  <Match when={health.latest?.status === "ok" && health.latest}>
                    {(value) => (
                      <span>
                        {subtitle(agent())}
                        {"version" in value() && value().version ? ` ${value().version}` : ""} · {agent().baseURL.replace(/^https?:\/\//, "")}
                      </span>
                    )}
                  </Match>
                  <Match when={health.latest && health.latest.status !== "ok"}>
                    <span class="text-bad">
                      Can't reach {agent().baseURL.replace(/^https?:\/\//, "")}
                      {"error" in health.latest! ? ` — ${health.latest!.error}` : ""}
                    </span>
                  </Match>
                </Switch>
              </div>
            </div>
            <Show when={live()?.link !== "live" && live()?.running}>
              <span class="shrink-0 text-[11px] text-warn">
                {live()?.link === "polling" ? "Following via status" : "Reconnecting…"}
              </span>
            </Show>
            <Show when={!reachable() && health.latest}>
              <HeaderButton title="Check again" onClick={() => void refetch()}>
                <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" stroke-linecap="round" stroke-linejoin="round" />
              </HeaderButton>
            </Show>
            <HeaderButton
              title="New conversation"
              onClick={async () => {
                if (thread()?.items.length && !(await ask({ message: `Start a new conversation with ${agent().name}?`, detail: "This clears the conversation here. The agent's earlier session stays on its server.", confirm: "New conversation" })))
                  return
                props.agents.newConversation(props.id)
              }}
            >
              <path d="M8 3.5v9M3.5 8h9" stroke-linecap="round" />
            </HeaderButton>
            <HeaderButton title="Agent settings" onClick={props.onEdit}>
              <circle cx="8" cy="8" r="2.2" />
              <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" stroke-linecap="round" />
            </HeaderButton>
          </header>

          <div ref={scroller} onScroll={onScroll} class="min-h-0 flex-1 overflow-y-auto">
            <div class="mx-auto flex max-w-[780px] flex-col gap-4 px-8 py-6">
              <Show when={!thread()?.items.length}>
                <div class="py-16 text-center">
                  <div class="mb-3 flex justify-center">
                    <Avatar profile={agent()} size="lg" />
                  </div>
                  <div class="text-[15px] text-text">{agent().name}</div>
                  <div class="mt-1 text-[12.5px] text-muted">What should it work on?</div>
                </div>
              </Show>
              <For each={thread()?.items}>
                {(item) => (
                  <Item
                    item={item}
                    pending={item.id === live()?.pending}
                    onApprove={(choice) => props.agents.approve(props.id, choice)}
                    onAnswer={(answer) => props.agents.answer(props.id, answer)}
                  />
                )}
              </For>
              <Show when={live()?.running && !pending()}>
                <div class="shimmer text-[12.5px] text-muted">Working…</div>
              </Show>
            </div>
          </div>

          <Show when={thread()?.queued.length}>
            <div class="shrink-0 px-8 pb-2">
              <div class="mx-auto flex max-w-[780px] flex-col gap-1.5">
                <div class="flex items-center gap-2 px-1 text-[11px] text-faint">
                  <span class="flex-1">
                    {thread()!.queueHeld ? "Held — the last run didn't finish" : "Sends when this run finishes"}
                  </span>
                  <Show when={thread()!.queueHeld && !live()?.running}>
                    <button
                      onClick={() => void props.agents.sendQueued(props.id)}
                      class="rounded px-1.5 py-0.5 text-text hover:bg-hover"
                    >
                      Send now
                    </button>
                  </Show>
                </div>
                <For each={thread()!.queued}>
                  {(queued) => (
                    <div class="group flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[13px] text-muted">
                      <span class="min-w-0 flex-1 truncate">{queued.text}</span>
                      <Show when={live()?.running}>
                        <SmallButton title="Send into the running task now" onClick={() => void props.agents.steerQueued(props.id, queued.id)}>
                          Steer now
                        </SmallButton>
                      </Show>
                      <SmallButton
                        title="Edit"
                        onClick={() => {
                          props.agents.removeQueued(props.id, queued.id)
                          setDraft({ text: queued.text, nonce: ++nonce })
                        }}
                      >
                        Edit
                      </SmallButton>
                      <SmallButton title="Remove" onClick={() => props.agents.removeQueued(props.id, queued.id)}>
                        ×
                      </SmallButton>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={live()?.error}>
            <div class="shrink-0 px-8 pb-2">
              <div class="mx-auto max-w-[780px] px-1 text-[12px] text-bad select-text">{live()!.error}</div>
            </div>
          </Show>

          <Composer
            busy={!!live()?.running}
            sendWhileBusy
            attachments={false}
            draft={draft()}
            placeholder={`Message ${agent().name}`}
            busyPlaceholder="Working… a message now waits for this run (or steer it in)"
            onSend={(text) => props.agents.send(props.id, text)}
            onStop={() => props.agents.stop(props.id)}
          />
        </div>
      )}
    </Show>
  )
}

function HeaderButton(props: { title: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      class="no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
    >
      <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.3">
        {props.children}
      </svg>
    </button>
  )
}

function SmallButton(props: { title: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      class="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-text"
    >
      {props.children}
    </button>
  )
}

// ---- timeline items -----------------------------------------------------------------

const CHOICES: Record<string, string> = {
  once: "Allow once",
  session: "Allow for this session",
  always: "Always allow",
  deny: "Deny",
}
const RESOLVED: Record<string, string> = {
  once: "Allowed once",
  session: "Allowed for this session",
  always: "Always allowed",
  deny: "Denied",
  expired: "Expired",
  elsewhere: "Answered on another device",
}

function Item(props: {
  item: AgentItem
  pending: boolean
  onApprove: (choice: string) => Promise<void>
  onAnswer: (answer: string) => Promise<void>
}) {
  const item = () => props.item
  return (
    <Switch>
      <Match when={item().kind === "user" && item()}>{(value) => <UserBubble text={(value() as { text: string }).text} />}</Match>
      <Match when={item().kind === "assistant" && item()}>
        {(value) => <Markdown text={(value() as { text: string }).text} />}
      </Match>
      <Match when={item().kind === "reasoning" && item()}>
        {(value) => <Narration text={(value() as { text: string }).text} />}
      </Match>
      <Match when={item().kind === "tool" && (item() as Extract<AgentItem, { kind: "tool" }>)}>
        {(tool) => (
          <div class="flex items-center gap-2 text-[12.5px] text-muted">
            <Switch fallback={<span class="size-1.5 shrink-0 rounded-full bg-ok" />}>
              <Match when={tool().running}>
                <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-warn" />
              </Match>
              <Match when={tool().error}>
                <span class="size-1.5 shrink-0 rounded-full bg-bad" />
              </Match>
            </Switch>
            <span class="shrink-0 font-mono text-[12px] text-text">{tool().name}</span>
            <Show when={tool().preview && tool().preview !== "null"}>
              <span class="min-w-0 truncate font-mono text-[11.5px] text-faint">{tool().preview}</span>
            </Show>
            <Show when={tool().duration !== undefined}>
              <span class="ml-auto shrink-0 text-[11px] text-faint">{formatDuration(tool().duration!)}</span>
            </Show>
          </div>
        )}
      </Match>
      <Match when={item().kind === "approval" && (item() as Extract<AgentItem, { kind: "approval" }>)}>
        {(approval) => (
          <Show when={props.pending && !approval().resolved} fallback={<ResolvedApproval item={approval()} />}>
            <ApprovalCard item={approval()} onApprove={props.onApprove} />
          </Show>
        )}
      </Match>
      <Match when={item().kind === "question" && (item() as Extract<AgentItem, { kind: "question" }>)}>
        {(question) => (
          <Show
            when={props.pending && question().answer === undefined}
            fallback={
              <Resolved tone="muted">
                <span class="text-text">{question().question}</span>
                <span class="text-faint"> → {question().answer ?? "(no answer)"}</span>
              </Resolved>
            }
          >
            <QuestionCard item={question()} onAnswer={props.onAnswer} />
          </Show>
        )}
      </Match>
      <Match when={item().kind === "steer" && item()}>
        {(value) => (
          <div class="flex justify-end text-[12px] text-muted">
            <span class="max-w-[85%] rounded-xl border border-dashed border-line px-3 py-1.5">
              ↪ {(value() as { text: string }).text}
            </span>
          </div>
        )}
      </Match>
      <Match when={item().kind === "status" && item()}>
        {(value) => {
          const text = (value() as { text: string }).text
          return <div classList={{ "text-bad": text.startsWith("Run failed"), "text-faint": !text.startsWith("Run failed") }} class="text-[12px] select-text">{text}</div>
        }}
      </Match>
    </Switch>
  )
}

const formatDuration = (seconds: number) => (seconds < 1 ? `${Math.round(seconds * 1000)}ms` : `${seconds.toFixed(1)}s`)

// Reasoning and narration: two muted lines, expandable.
function Narration(props: { text: string }) {
  const [open, setOpen] = createSignal(false)
  const long = () => props.text.length > 180 || props.text.split("\n").length > 2
  return (
    <div class="border-l-2 border-line pl-3 text-[12.5px] leading-relaxed text-muted">
      <div classList={{ "line-clamp-2": !open() }} class="whitespace-pre-wrap select-text">
        {props.text}
      </div>
      <Show when={long()}>
        <button onClick={() => setOpen(!open())} class="mt-0.5 text-[11.5px] text-faint hover:text-text">
          {open() ? "Show less" : "Show more"}
        </button>
      </Show>
    </div>
  )
}

function Resolved(props: { tone: "ok" | "bad" | "muted"; children: JSX.Element }) {
  return (
    <div
      classList={{ "border-ok/60": props.tone === "ok", "border-bad/60": props.tone === "bad", "border-line": props.tone === "muted" }}
      class="border-l-[3px] py-0.5 pl-3 text-[12.5px] text-muted select-text"
    >
      {props.children}
    </div>
  )
}

function ResolvedApproval(props: { item: Extract<AgentItem, { kind: "approval" }> }) {
  const resolved = () => props.item.resolved ?? "expired"
  const tone = () => (resolved() === "deny" ? "bad" : ["expired", "elsewhere"].includes(resolved()) ? "muted" : "ok")
  return (
    <Resolved tone={tone()}>
      <span class="text-text">{RESOLVED[resolved()] ?? resolved()}</span>
      <span class="font-mono text-[11.5px] text-faint"> · {props.item.command ?? props.item.tool ?? "action"}</span>
    </Resolved>
  )
}

function ApprovalCard(props: { item: Extract<AgentItem, { kind: "approval" }>; onApprove: (choice: string) => Promise<void> }) {
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const choose = async (choice: string) => {
    setBusy(choice)
    setError(undefined)
    try {
      await props.onApprove(choice)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(undefined)
    }
  }
  const choices = () => props.item.choices.filter((choice) => choice !== "deny")
  return (
    <div class="rounded-xl border border-warn/50 bg-elevated p-4 shadow-[0_2px_12px_rgb(0_0_0/0.12)]">
      <div class="mb-1 flex items-center gap-2 text-[12px] font-medium text-warn">
        <span class="size-1.5 rounded-full bg-warn" /> Approval needed
        <Show when={props.item.tool}>
          <span class="font-mono font-normal text-faint">{props.item.tool}</span>
        </Show>
      </div>
      <Show when={props.item.reason}>
        <div class="mb-2.5 text-[14px] text-text select-text">{props.item.reason}</div>
      </Show>
      <Show when={props.item.command}>
        <pre class="mb-3 max-h-[160px] overflow-auto rounded-md bg-sidebar px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted select-text">
          {props.item.command}
        </pre>
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <For each={choices()}>
          {(choice, index) => (
            <button
              disabled={!!busy()}
              onClick={() => void choose(choice)}
              classList={{
                "bg-text text-bg font-medium": index() === 0,
                "border border-line text-text hover:bg-hover": index() > 0,
              }}
              class="h-8 rounded-md px-3.5 text-[12.5px] disabled:opacity-50"
            >
              {CHOICES[choice] ?? choice}
            </button>
          )}
        </For>
        <Show when={props.item.choices.includes("deny")}>
          <button
            disabled={!!busy()}
            onClick={() => void choose("deny")}
            class="h-8 rounded-md px-3 text-[12.5px] text-muted hover:bg-hover hover:text-text disabled:opacity-50"
          >
            Deny
          </button>
        </Show>
        <Show when={error()}>
          <span class="text-[12px] text-bad">{error()}</span>
        </Show>
      </div>
    </div>
  )
}

function QuestionCard(props: { item: Extract<AgentItem, { kind: "question" }>; onAnswer: (answer: string) => Promise<void> }) {
  const [picked, setPicked] = createSignal<string[]>([])
  const [text, setText] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const submit = async (answer: string) => {
    if (!answer.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      await props.onAnswer(answer.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  const toggle = (choice: string) =>
    setPicked((current) => (current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice]))
  return (
    <div class="rounded-xl border border-line bg-elevated p-4 shadow-[0_2px_12px_rgb(0_0_0/0.12)]">
      <div class="mb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Question</div>
      <div class="mb-3 text-[14px] leading-snug text-text select-text">
        <Markdown text={props.item.question} />
      </div>
      <Show when={props.item.choices.length}>
        <div class="mb-3 flex flex-col gap-1.5">
          <For each={props.item.choices}>
            {(choice) => (
              <button
                disabled={busy()}
                onClick={() => (props.item.multiSelect ? toggle(choice) : void submit(choice))}
                classList={{
                  "border-[var(--muted)] bg-active": picked().includes(choice),
                  "border-line hover:bg-hover": !picked().includes(choice),
                }}
                class="rounded-lg border px-3 py-2 text-left text-[13px] text-text disabled:opacity-50"
              >
                {props.item.multiSelect ? (picked().includes(choice) ? "☑ " : "☐ ") : ""}
                {choice}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center gap-2">
        <input
          disabled={busy()}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && void submit(text())}
          placeholder={props.item.choices.length ? "Or type an answer…" : "Type your answer…"}
          class="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-[13px] text-text outline-none placeholder:text-faint focus:border-[var(--muted)]"
        />
        <button
          disabled={busy() || !(text().trim() || (props.item.multiSelect && picked().length))}
          onClick={() => void submit(text().trim() || picked().join(", "))}
          class="h-8 rounded-md bg-text px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-40"
        >
          Answer
        </button>
      </div>
      <Show when={error()}>
        <div class="mt-2 text-[12px] text-bad">{error()}</div>
      </Show>
    </div>
  )
}

// ---- adding and editing an agent ------------------------------------------------------

export function AgentEditor(props: {
  agents: Agents
  // Undefined adds a new agent.
  profile?: AgentProfile
  onClose: () => void
  onSaved: (id: string) => void
  onRemoved: (id: string) => void
}) {
  const creating = !props.profile
  const draft = props.profile ?? newProfile({ name: "", baseURL: "http://127.0.0.1:8642" })
  const [name, setName] = createSignal(draft.name)
  const [emoji, setEmoji] = createSignal(draft.emoji)
  const [baseURL, setBaseURL] = createSignal(draft.baseURL)
  const [profileName, setProfileName] = createSignal(draft.profile ?? "")
  const [instructions, setInstructions] = createSignal(draft.instructions ?? "")
  const [policy, setPolicy] = createSignal<ApprovalPolicy>(draft.approvalPolicy)
  const [pinned, setPinned] = createSignal(!!draft.pinned)
  const [key, setKey] = createSignal("")
  const [local] = createResource(() => window.caimex.hermes.local())
  const [hasKey, { refetch: refetchKey }] = createResource(() => window.caimex.hermes.hasKey(draft.id))
  const [check, setCheck] = createSignal<{ ok: boolean; text: string }>()
  const [error, setError] = createSignal<string>()
  // A key stored for an agent that is then never saved must not linger.
  let saved = false
  onCleanup(() => {
    if (creating && !saved) void window.caimex.hermes.setKey(draft.id, undefined)
  })
  onMount(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose()
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const profile = createMemo<AgentProfile>(() => ({
    ...draft,
    name: name().trim() || title(profileName().trim()) || "Hermes",
    emoji: emoji().trim() || draft.emoji,
    baseURL: baseURL().trim().replace(/\/+$/, ""),
    profile: profileName().trim() || undefined,
    instructions: instructions().trim() || undefined,
    approvalPolicy: policy(),
    pinned: pinned(),
  }))

  const storeKey = async () => {
    if (key().trim()) {
      await window.caimex.hermes.setKey(draft.id, key())
      setKey("")
      await refetchKey()
    }
  }

  const test = async () => {
    setCheck(undefined)
    try {
      await storeKey()
      const value = profile()
      const result = await hermes.health({ id: value.id, baseURL: value.baseURL, profile: value.profile })
      // Health answers without a key; a run-free authenticated call proves the key.
      await window.caimex.hermes
        .request({ id: value.id, baseURL: value.baseURL, profile: value.profile }, "GET", "v1/capabilities")
        .then(({ status }) => {
          if (status === 401 || status === 403) throw new Error("The address answers, but the API key was refused.")
          if (status === 0) throw new Error("No API key saved for this agent yet.")
        })
      setCheck({ ok: true, text: `Connected to ${result.platform ?? "Hermes"}${result.version ? ` ${result.version}` : ""}` })
    } catch (cause) {
      setCheck({ ok: false, text: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const save = async () => {
    setError(undefined)
    try {
      new URL(profile().baseURL)
    } catch {
      return setError("The address should look like http://127.0.0.1:8642")
    }
    await storeKey()
    if (!(await window.caimex.hermes.hasKey(draft.id))) return setError("Add the agent's API key (Hermes' API_SERVER_KEY).")
    saved = true
    if (creating) props.agents.add(profile())
    else props.agents.update(profile())
    props.onSaved(draft.id)
    props.onClose()
  }

  return (
    <div
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-8"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div class="flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-[0_20px_60px_rgb(0_0_0/0.35)]">
        <div class="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div class="text-[14px] font-medium">{creating ? "Add agent" : "Agent settings"}</div>
          <button onClick={props.onClose} class="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-text">
            Cancel
          </button>
        </div>
        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          <div class="flex gap-2">
            <Field label="Icon" class="w-16">
              <input value={emoji()} onInput={(event) => setEmoji(event.currentTarget.value)} class={`${INPUT} text-center`} maxLength={4} />
            </Field>
            <Field label="Name" class="flex-1">
              <input value={name()} onInput={(event) => setName(event.currentTarget.value)} placeholder="Research assistant" class={INPUT} />
            </Field>
          </div>
          <Field label="Address" hint="Hermes' API server. The app talks to it directly, so a local address is fine.">
            <input value={baseURL()} onInput={(event) => setBaseURL(event.currentTarget.value)} class={`${INPUT} font-mono`} />
          </Field>
          <Field label="Profile" hint="Optional. A multiplexed Hermes profile on that server.">
            <input
              value={profileName()}
              onInput={(event) => setProfileName(event.currentTarget.value)}
              placeholder="default"
              list="hermes-profiles"
              class={`${INPUT} font-mono`}
            />
            <datalist id="hermes-profiles">
              <For each={local()?.found ? (local() as { profiles: string[] }).profiles : []}>{(item) => <option value={item} />}</For>
            </datalist>
          </Field>
          <Field label="API key" hint="Stored encrypted by macOS; the app never shows it again.">
            <div class="flex gap-2">
              <input
                type="password"
                value={key()}
                onInput={(event) => setKey(event.currentTarget.value)}
                placeholder={hasKey() ? "Saved · type to replace" : "API_SERVER_KEY"}
                class={`${INPUT} flex-1 font-mono`}
              />
              <Show when={local()?.found && (local() as { hasKey: boolean }).hasKey}>
                <button
                  onClick={async () => {
                    await window.caimex.hermes.useLocalKey(draft.id)
                    await refetchKey()
                    setCheck(undefined)
                  }}
                  class="h-8 shrink-0 rounded-md border border-line px-3 text-[12px] text-text hover:bg-hover"
                >
                  Use this Mac's key
                </button>
              </Show>
            </div>
          </Field>
          <Field label="Approvals" hint="Questions always wait for you.">
            <div class="flex gap-1 rounded-lg bg-active p-0.5">
              <For each={[["ask", "Ask me"], ["session", "Allow for session"], ["always", "Always allow"]] as const}>
                {([value, label]) => (
                  <button
                    onClick={() => setPolicy(value)}
                    classList={{ "bg-elevated text-text shadow-[0_1px_3px_rgb(0_0_0/0.15)]": policy() === value, "text-muted": policy() !== value }}
                    class="h-7 flex-1 rounded-md text-[12px]"
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
          </Field>
          <Field label="Instructions" hint="Optional. Added to every run.">
            <textarea
              value={instructions()}
              onInput={(event) => setInstructions(event.currentTarget.value)}
              rows={3}
              placeholder="e.g. Keep reports under a page and cite sources."
              class={`${INPUT} h-auto resize-none py-2 leading-relaxed`}
            />
          </Field>
          <label class="flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={pinned()} onChange={(event) => setPinned(event.currentTarget.checked)} />
            Pin to the top of the list
          </label>
          <Show when={check()}>
            {(value) => <div classList={{ "text-ok": value().ok, "text-bad": !value().ok }} class="text-[12px] select-text">{value().text}</div>}
          </Show>
          <Show when={error()}>
            <div class="text-[12px] text-bad">{error()}</div>
          </Show>
        </div>
        <div class="flex items-center gap-2 border-t border-line px-5 py-3.5">
          <Show when={!creating}>
            <button
              onClick={async () => {
                if (!(await ask({ message: `Remove ${draft.name}?`, detail: "Its conversation here and its saved key are deleted. Nothing changes on the Hermes server.", confirm: "Remove", danger: true })))
                  return
                await props.agents.remove(draft.id)
                props.onRemoved(draft.id)
                props.onClose()
              }}
              class="h-8 rounded-md px-3 text-[12.5px] text-bad hover:bg-hover"
            >
              Remove
            </button>
          </Show>
          <div class="flex-1" />
          <button onClick={() => void test()} class="h-8 rounded-md border border-line px-3.5 text-[12.5px] text-text hover:bg-hover">
            Test connection
          </button>
          <button onClick={() => void save()} class="h-8 rounded-md bg-text px-3.5 text-[12.5px] font-medium text-bg">
            {creating ? "Add agent" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

const INPUT =
  "h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-text outline-none placeholder:text-faint focus:border-[var(--muted)]"

function Field(props: { label: string; hint?: string; class?: string; children: JSX.Element }) {
  return (
    <label class={`flex flex-col gap-1.5 ${props.class ?? ""}`}>
      <span class="text-[12px] font-medium text-muted">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-[11.5px] text-faint">{props.hint}</span>
      </Show>
    </label>
  )
}
