import { createResource, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import type { Api, SignInAttempt } from "../api"
import { CODE_FONTS, type Settings, TEXT_SIZES } from "../settings"

export function SettingsDialog(props: {
  api: Api
  settings: Settings
  onSettings: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  onAccountChanged: () => void
  onClose: () => void
}) {
  const [info] = createResource(() => window.caimex.info())
  const [health] = createResource(() => props.api.health())

  onMount(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose()
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <div
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-8"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div class="flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-[0_20px_60px_rgb(0_0_0/0.35)]">
        <div class="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div class="text-[14px] font-medium">Settings</div>
          <button onClick={props.onClose} class="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-text">
            Done
          </button>
        </div>
        <div class="flex flex-col gap-6 overflow-y-auto px-5 py-5">
          <Section title="Account">
            <Account api={props.api} onChanged={props.onAccountChanged} />
          </Section>

          <Section title="Appearance">
            <Row label="Theme">
              <span class="text-[12.5px] text-muted">Follows macOS</span>
            </Row>
            <Row label="Text size">
              <Segmented
                options={TEXT_SIZES.map((size) => ({ label: size.label, value: size.zoom }))}
                value={props.settings.zoom}
                onChange={(zoom) => props.onSettings("zoom", zoom)}
              />
            </Row>
            <Row label="Code font">
              <Segmented
                options={Object.entries(CODE_FONTS).map(([value, font]) => ({
                  label: font.label,
                  value: value as Settings["codeFont"],
                }))}
                value={props.settings.codeFont}
                onChange={(font) => props.onSettings("codeFont", font)}
              />
            </Row>
            <div class="mt-1 rounded-md bg-sidebar px-3 py-2 font-mono text-[12px] text-muted">
              const answer = await caimex.ask("hello")
            </div>
          </Section>

          <Section title="About">
            <div class="flex flex-col gap-1 text-[12px] text-muted">
              <span>Caimex Code {info()?.version ?? ""}</span>
              <span class="font-mono text-[11px] text-faint select-text">
                daemon {props.api.url}
                {health()?.pid ? ` · pid ${health()!.pid}` : ""}
              </span>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section>
      <div class="mb-2.5 text-[11px] font-medium tracking-wide text-faint uppercase">{props.title}</div>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  )
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <span class="text-[13px] text-text">{props.label}</span>
      {props.children}
    </div>
  )
}

function Segmented<T>(props: { options: { label: string; value: T }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div class="flex h-7 items-center rounded-md border border-line p-0.5">
      <For each={props.options}>
        {(option) => (
          <button
            onClick={() => props.onChange(option.value)}
            classList={{
              "bg-active text-text": props.value === option.value,
              "text-muted hover:text-text": props.value !== option.value,
            }}
            class="h-full rounded-[5px] px-2.5 text-[12px]"
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The device code is in the activation URL (?code=) and repeated in the instructions.
function codeOf(attempt: SignInAttempt) {
  try {
    const code = new URL(attempt.url).searchParams.get("code")
    if (code) return code
  } catch {
    // fall through to the instructions
  }
  return /code:?\s*([A-Z0-9-]{4,})/i.exec(attempt.instructions)?.[1]
}

function Account(props: { api: Api; onChanged: () => void }) {
  const [integration, { refetch }] = createResource(() => props.api.integration())
  const credential = () => integration()?.connections.find((item) => item.type === "credential")
  const environment = () => integration()?.connections.find((item) => item.type === "env")

  const [attempt, setAttempt] = createSignal<SignInAttempt>()
  const [code, setCode] = createSignal("")
  const [message, setMessage] = createSignal<string>()
  const [working, setWorking] = createSignal(false)
  const [keyEntry, setKeyEntry] = createSignal(false)
  const [key, setKey] = createSignal("")
  const [confirmSignOut, setConfirmSignOut] = createSignal(false)
  let polling = 0

  const done = async () => {
    await refetch()
    props.onChanged()
  }

  const poll = async (current: SignInAttempt) => {
    const token = ++polling
    while (token === polling) {
      await wait(2000)
      if (token !== polling) return
      const status = await props.api.signInStatus(current.attemptID).catch(() => undefined)
      if (!status || status.status === "pending") continue
      polling++
      setAttempt(undefined)
      if (status.status === "complete") await done()
      else setMessage(status.status === "failed" ? status.message : "That code expired. Try again.")
      return
    }
  }

  const signIn = async () => {
    setMessage(undefined)
    setWorking(true)
    try {
      const started = await props.api.startSignIn("device")
      setAttempt(started)
      if (started.mode === "auto") void window.caimex.openExternal(started.url)
      void poll(started)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  const cancel = () => {
    polling++
    const current = attempt()
    setAttempt(undefined)
    if (current) void props.api.cancelSignIn(current.attemptID).catch(() => {})
  }
  // Closing Settings mid sign-in abandons the attempt rather than leaving it polling.
  onCleanup(cancel)

  const finish = async () => {
    const current = attempt()
    if (!current || !code().trim()) return
    setWorking(true)
    try {
      await props.api.finishSignIn(current.attemptID, code().trim())
      polling++
      setAttempt(undefined)
      await done()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  const saveKey = async () => {
    if (!key().trim()) return
    setWorking(true)
    setMessage(undefined)
    try {
      await props.api.useKey(key().trim())
      setKey("")
      setKeyEntry(false)
      await done()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  const signOut = async () => {
    const current = credential()
    if (!current || current.type !== "credential") return
    setWorking(true)
    try {
      await props.api.signOut(current.id)
      setConfirmSignOut(false)
      await done()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div class="flex flex-col gap-3">
      <Show when={!integration.loading || integration.latest} fallback={<span class="text-[12.5px] text-faint">Checking…</span>}>
        <Show
          when={!attempt()}
          fallback={
            <div class="rounded-lg border border-line bg-sidebar p-4">
              <div class="mb-1 text-[12.5px] text-muted">Enter this code in the page that opened in your browser:</div>
              <div class="mb-3 font-mono text-[22px] tracking-[0.12em] text-text select-text">{codeOf(attempt()!)}</div>
              <Show when={attempt()!.mode === "code"}>
                <div class="mb-3 flex gap-2">
                  <input
                    value={code()}
                    onInput={(event) => setCode(event.currentTarget.value)}
                    placeholder="Paste the code shown after approving"
                    class="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-[12.5px] outline-none"
                  />
                  <button onClick={() => void finish()} class="h-8 rounded-md bg-text px-3 text-[12.5px] text-bg">
                    Continue
                  </button>
                </div>
              </Show>
              <div class="flex items-center gap-3 text-[12px]">
                <span class="shimmer">Waiting for approval…</span>
                <button onClick={() => void window.caimex.openExternal(attempt()!.url)} class="text-text underline">
                  Open again
                </button>
                <button onClick={cancel} class="text-muted hover:text-text">
                  Cancel
                </button>
              </div>
            </div>
          }
        >
          <div class="flex items-center gap-2.5">
            <span
              class="size-2 shrink-0 rounded-full"
              classList={{ "bg-ok": !!(credential() || environment()), "bg-warn": !(credential() || environment()) }}
            />
            <span class="flex-1 text-[13px] text-text">
              {credential()
                ? "Signed in to Caimex"
                : environment()
                  ? "Using CAIMEX_API_KEY from the environment"
                  : "Not signed in"}
            </span>
            <Show when={credential()}>
              <Show
                when={confirmSignOut()}
                fallback={
                  <button
                    onClick={() => setConfirmSignOut(true)}
                    class="rounded-md px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-text"
                  >
                    Sign out
                  </button>
                }
              >
                <button
                  disabled={working()}
                  onClick={() => void signOut()}
                  class="rounded-md bg-bad/15 px-2.5 py-1 text-[12px] text-bad hover:bg-bad/25"
                >
                  Confirm sign out
                </button>
                <button onClick={() => setConfirmSignOut(false)} class="px-1.5 text-[12px] text-muted">
                  Keep
                </button>
              </Show>
            </Show>
          </div>
          <Show when={environment() && credential()}>
            <div class="text-[11.5px] text-faint">CAIMEX_API_KEY is also set in the daemon's environment.</div>
          </Show>
          <Show when={!credential()}>
            <div class="flex flex-wrap items-center gap-2">
              <button
                disabled={working()}
                onClick={() => void signIn()}
                class="h-8 rounded-md bg-text px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-50"
              >
                Sign in with Caimex
              </button>
              <button
                onClick={() => setKeyEntry(!keyEntry())}
                class="h-8 rounded-md px-3 text-[12.5px] text-muted hover:bg-hover hover:text-text"
              >
                Use an API key
              </button>
            </div>
            <Show when={keyEntry()}>
              <div class="flex gap-2">
                <input
                  type="password"
                  value={key()}
                  onInput={(event) => setKey(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Enter" && void saveKey()}
                  placeholder="Caimex API key"
                  class="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-[12.5px] outline-none placeholder:text-faint"
                />
                <button
                  disabled={working() || !key().trim()}
                  onClick={() => void saveKey()}
                  class="h-8 rounded-md border border-line px-3 text-[12.5px] text-text hover:bg-hover disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </Show>
          </Show>
        </Show>
        <Show when={message()}>
          <div class="text-[12px] text-bad select-text">{message()}</div>
        </Show>
      </Show>
    </div>
  )
}
