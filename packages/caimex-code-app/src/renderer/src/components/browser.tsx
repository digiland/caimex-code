import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { BrowserEvent, BrowserInventory } from "../api"

// The agent's browser for one session. The pages are native views the main process
// places over this window, so this component draws the chrome (tabs, address bar) and
// a slot, and keeps reporting where that slot is; the page is laid over it.
//
// Opening this tab attaches the session's browser to the daemon, which is what lets
// the agent use its browser tools. It stays attached until "Stop", so switching tabs
// or sessions doesn't take the browser away mid-task.

const bridge = () => window.caimex.browser

const address = (input: string) => {
  const value = input.trim()
  if (!value) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(value)) return `http://${value}`
  if (/^[^\s]+\.[^\s]{2,}$/.test(value)) return `https://${value}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

export function BrowserView(props: { sessionID: string; directory: string; visible: boolean }) {
  const [inventory, setInventory] = createStore<BrowserInventory>({ tabs: [], focusedTabID: null })
  const [status, setStatus] = createSignal<"off" | "attaching" | "attached">("off")
  const [problem, setProblem] = createSignal<string>()
  const [typed, setTyped] = createSignal<string>()
  // Which native view shows each tab.
  const embeds = new Map<string, string>()
  const [embedsVersion, setEmbedsVersion] = createSignal(0)
  // An overlay (dialog, palette) is up: native views would draw over it.
  const [covered, setCovered] = createSignal(false)

  const focused = () => inventory.tabs.find((tab) => tab.id === inventory.focusedTabID)

  const attach = async () => {
    setProblem(undefined)
    setStatus("attaching")
    try {
      await bridge().attach(props.sessionID, props.directory)
    } catch (cause) {
      setStatus("off")
      setProblem(cause instanceof Error ? cause.message : String(cause))
    }
  }

  onMount(() => {
    const off = bridge().onEvent((event: BrowserEvent) => {
      if (event.sessionID !== props.sessionID) return
      if (event.type === "state") {
        setInventory(reconcile(event.state, { key: "id" }))
        setProblem(event.error)
      } else if (event.type === "embed") {
        embeds.set(event.tabID, event.embed)
        setEmbedsVersion((n) => n + 1)
      } else if (event.type === "status") {
        if (event.status === "closed") {
          setStatus("off")
          if (event.reason && event.reason !== "closed")
            setProblem(
              event.reason === "replaced"
                ? "Another window took over this session's browser."
                : event.reason === "unsupported"
                  ? "This daemon has no browser plugin. Update Caimex to use the browser."
                  : event.reason,
            )
        } else setStatus(event.status)
      }
    })
    onCleanup(off)
    // Pick up a browser that is already running (a reload, or coming back to the session).
    void bridge()
      .state(props.sessionID)
      .then((current) => {
        if (!current) return void attach()
        for (const [tab, embed] of Object.entries(current.embeds)) embeds.set(tab, embed)
        setEmbedsVersion((n) => n + 1)
        setInventory(reconcile(current.state, { key: "id" }))
        setStatus(current.attached ? "attached" : "attaching")
      })

    const watch = new MutationObserver(() => setCovered(!!document.querySelector(".fixed.inset-0")))
    watch.observe(document.body, { childList: true, subtree: true })
    onCleanup(() => watch.disconnect())
  })

  // Keep the focused tab's view over the slot; every other view is off screen.
  let slot!: HTMLDivElement
  const [rect, setRect] = createSignal<DOMRect>()
  onMount(() => {
    const measure = () => setRect(slot.getBoundingClientRect())
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    window.addEventListener("resize", measure)
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    })
  })
  createEffect(() => {
    embedsVersion()
    rect()
    // The bars above the slot come and go with these; measure afresh rather than wait for
    // the observer, which only reports once the window paints.
    status()
    problem()
    const box = slot.getBoundingClientRect()
    const show = props.visible && !covered() && box && box.width > 0 ? box : null
    for (const [tab, embed] of embeds)
      bridge().layout(
        embed,
        tab === inventory.focusedTabID && show
          ? { x: show.x, y: show.y, width: show.width, height: show.height }
          : null,
      )
  })
  onCleanup(() => {
    for (const embed of embeds.values()) bridge().layout(embed, null)
  })

  const go = (event: SubmitEvent) => {
    event.preventDefault()
    const url = address(typed() ?? "")
    setTyped(undefined)
    // As in a browser: the page takes over, and the next click on the bar selects it all.
    ;(event.currentTarget as HTMLFormElement).querySelector("input")?.blur()
    if (!url) return
    const tab = focused()
    void (tab ? bridge().navigate(props.sessionID, tab.id, url) : bridge().open(props.sessionID, url))
  }

  const step = (direction: "back" | "forward" | "reload") => {
    const tab = focused()
    if (tab) void bridge().go(props.sessionID, tab.id, direction)
  }

  return (
    <div class="flex h-full flex-col">
      <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5 [scrollbar-width:none]">
        <For each={inventory.tabs}>
          {(tab) => (
            <div
              classList={{
                "bg-active text-text": tab.id === inventory.focusedTabID,
                "text-muted hover:bg-hover": tab.id !== inventory.focusedTabID,
              }}
              class="group flex h-6 max-w-[150px] shrink-0 items-center rounded-md pl-2 text-[11.5px]"
            >
              <button class="min-w-0 truncate" title={tab.url} onClick={() => void bridge().focus(props.sessionID, tab.id)}>
                {tab.loading ? "Loading…" : tab.title || tab.url || "New tab"}
              </button>
              <button
                title="Close tab"
                onClick={() => void bridge().close(props.sessionID, tab.id)}
                class="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:text-text group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          )}
        </For>
        <button
          title="New tab"
          disabled={status() !== "attached" && status() !== "attaching"}
          onClick={() => void bridge().open(props.sessionID, "about:blank")}
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-text disabled:opacity-40"
        >
          +
        </button>
        <div class="flex-1" />
        <Show
          when={status() !== "off"}
          fallback={
            <button onClick={() => void attach()} class="shrink-0 rounded px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-text">
              Start
            </button>
          }
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            classList={{ "bg-ok": status() === "attached", "bg-faint animate-pulse": status() === "attaching" }}
            title={status() === "attached" ? "The agent can use this browser" : "Connecting…"}
          />
          <button
            onClick={() => void bridge().detach(props.sessionID)}
            title="Close the browser and take it away from the agent"
            class="shrink-0 rounded px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-text"
          >
            Stop
          </button>
        </Show>
      </div>
      <Show when={status() !== "off"}>
        <form onSubmit={go} class="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1">
          <NavButton label="Back" disabled={!focused()?.canGoBack} onClick={() => step("back")}>
            ‹
          </NavButton>
          <NavButton label="Forward" disabled={!focused()?.canGoForward} onClick={() => step("forward")}>
            ›
          </NavButton>
          <NavButton label="Reload" disabled={!focused()} onClick={() => step("reload")}>
            ↻
          </NavButton>
          <input
            value={typed() ?? (!focused() || focused()!.url === "about:blank" ? "" : focused()!.url)}
            onInput={(event) => setTyped(event.currentTarget.value)}
            onBlur={() => setTyped(undefined)}
            onFocus={(event) => {
              bridge().focusApp()
              event.currentTarget.select()
            }}
            placeholder="Search or enter address"
            spellcheck={false}
            class="ml-1 h-6 min-w-0 flex-1 rounded-md bg-hover px-2 text-[12px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-line"
          />
        </form>
      </Show>
      <Show when={problem()}>
        <div class="shrink-0 border-b border-line px-3 py-1.5 text-[11.5px] text-bad">{problem()}</div>
      </Show>
      <div ref={slot} class="relative min-h-0 flex-1 bg-white/[0.02]">
        <Show when={!inventory.tabs.length}>
          <div class="flex h-full flex-col items-center justify-center gap-1 px-8 text-center text-[12px] text-faint">
            <Show
              when={status() === "attached"}
              fallback={<div>{status() === "attaching" ? "Connecting the browser…" : "The browser is off."}</div>}
            >
              <div class="text-muted">No pages open</div>
              <div>Ask the agent to open a page, or type an address above.</div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

function NavButton(props: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      class="flex size-6 shrink-0 items-center justify-center rounded text-[14px] text-muted hover:bg-hover hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {props.children}
    </button>
  )
}
