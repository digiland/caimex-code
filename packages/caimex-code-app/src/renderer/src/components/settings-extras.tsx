import { createResource, createSignal, For, Show } from "solid-js"
import type { Api, PluginEntry } from "../api"
import { projectName } from "../format"
import { ask } from "./confirm"

// ---------------------------------------------------------------------------
// Saved permissions: the "Always allow" answers the daemon remembers per project.

export function SavedPermissions(props: { api: Api; directories: string[] }) {
  const [saved, { refetch, mutate }] = createResource(() => props.api.savedPermissions())
  // Saved rules carry a project id; name it after a folder that belongs to it.
  const [projects] = createResource(
    () => props.directories,
    async (directories) => {
      const names = new Map<string, string>()
      await Promise.all(
        directories.map(async (directory) => {
          const location = await props.api.location(directory).catch(() => undefined)
          if (location && !names.has(location.project.id)) names.set(location.project.id, location.project.directory)
        }),
      )
      return names
    },
  )
  const [error, setError] = createSignal<string>()
  const groups = () => {
    const byProject = new Map<string, NonNullable<ReturnType<typeof saved>>>()
    for (const item of saved.latest ?? []) byProject.set(item.projectID, [...(byProject.get(item.projectID) ?? []), item])
    return [...byProject.entries()]
  }
  const forget = async (id: string) => {
    setError(undefined)
    try {
      await props.api.removeSavedPermission(id)
      mutate((current) => current?.filter((item) => item.id !== id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void refetch()
    }
  }
  return (
    <div class="flex flex-col gap-2">
      <Show when={saved.error}>
        <div class="text-[12px] text-bad">Couldn't load them: {String(saved.error?.message ?? saved.error)}</div>
      </Show>
      <Show when={saved.latest && !saved.latest.length}>
        <div class="text-[12.5px] text-muted">None yet. Choosing “Always allow” on a permission request saves one here.</div>
      </Show>
      <For each={groups()}>
        {([projectID, items]) => {
          const directory = () => projects.latest?.get(projectID)
          return (
            <div>
              <div class="mb-1 truncate text-[11.5px] text-faint" title={directory() ?? projectID}>
                {directory() ? projectName(directory()!) : `Project ${projectID.slice(0, 8)}`}
              </div>
              <div class="flex flex-col divide-y divide-[var(--border)] rounded-md border border-line">
                <For each={items}>
                  {(item) => (
                    <div class="flex items-center gap-2 px-3 py-1.5">
                      <span class="shrink-0 text-[12px] text-text">{item.action}</span>
                      <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={item.resource}>
                        {item.resource}
                      </span>
                      <button
                        onClick={() => void forget(item.id)}
                        class="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-bad"
                      >
                        Forget
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )
        }}
      </For>
      <Show when={error()}>
        <div class="text-[12px] text-bad">{error()}</div>
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugins: packages the daemon loads at start. Saved to the global config; applying
// them means restarting the daemon.

export function Plugins(props: { onRestart: () => Promise<void> }) {
  const [config, { mutate }] = createResource(() => window.caimex.plugins.list())
  const [draft, setDraft] = createSignal("")
  const [options, setOptions] = createSignal("")
  const [error, setError] = createSignal<string>()
  // Saved but not yet loaded by the daemon.
  const [pending, setPending] = createSignal(false)
  const [restarting, setRestarting] = createSignal(false)

  const save = async (entries: PluginEntry[]) => {
    setError(undefined)
    try {
      mutate(await window.caimex.plugins.save(entries))
      setPending(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause))
    }
  }

  const add = async () => {
    const name = draft().trim()
    if (!name) return
    let parsed: Record<string, unknown> | undefined
    if (options().trim()) {
      try {
        parsed = JSON.parse(options())
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
      } catch {
        return setError("Options must be a JSON object, e.g. {\"level\": \"debug\"}")
      }
    }
    await save([...(config.latest?.entries ?? []), { package: name, ...(parsed ? { options: parsed } : {}) }])
    setDraft("")
    setOptions("")
  }

  const restart = async () => {
    const confirmed = await ask({
      message: "Restart the Caimex daemon?",
      detail:
        "It stops and starts again so plugins load. Anything running right now, in this app, the CLI or the other desktop app, is interrupted.",
      confirm: "Restart",
    })
    if (!confirmed) return
    setRestarting(true)
    setError(undefined)
    try {
      await props.onRestart()
      setPending(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="text-[12px] leading-snug text-muted">
        Plugins add modes, commands, skills, references and models to the agent. They load when the daemon starts; see
        what they added under Library in the side pane.
      </div>
      <Show when={config.error}>
        <div class="text-[12px] text-bad">{String(config.error?.message ?? config.error)}</div>
      </Show>
      <Show when={config.latest}>
        {(value) => (
          <>
            <Show
              when={value().entries.length || value().files.length}
              fallback={<div class="text-[12.5px] text-faint">No plugins.</div>}
            >
              <div class="flex flex-col divide-y divide-[var(--border)] rounded-md border border-line">
                <For each={value().entries}>
                  {(entry, index) => (
                    <div class="flex items-center gap-2 px-3 py-2">
                      <div class="min-w-0 flex-1">
                        <div class="truncate font-mono text-[12px] text-text">{entry.package}</div>
                        <Show when={entry.options}>
                          <div class="truncate font-mono text-[10.5px] text-faint">{JSON.stringify(entry.options)}</div>
                        </Show>
                      </div>
                      <button
                        onClick={() => void save(value().entries.filter((_, i) => i !== index()))}
                        class="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-bad"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </For>
                <For each={value().files}>
                  {(file) => (
                    <div class="flex items-center gap-2 px-3 py-2" title={file}>
                      <div class="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{file.split("/").at(-1)}</div>
                      <span class="shrink-0 text-[10.5px] text-faint">file in plugins folder</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex flex-col gap-1.5">
              <div class="flex gap-2">
                <input
                  value={draft()}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Enter" && void add()}
                  placeholder="npm package, or /absolute/path/plugin.ts"
                  class="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 font-mono text-[12px] text-text outline-none placeholder:text-faint focus:border-[var(--muted)]"
                />
                <button
                  disabled={!draft().trim()}
                  onClick={() => void add()}
                  class="h-8 shrink-0 rounded-md border border-line px-3 text-[12px] text-text hover:bg-hover disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              <input
                value={options()}
                onInput={(event) => setOptions(event.currentTarget.value)}
                placeholder='Options (optional JSON), e.g. {"level": "debug"}'
                class="h-7 rounded-md border border-line bg-bg px-2.5 font-mono text-[11.5px] text-text outline-none placeholder:text-faint focus:border-[var(--muted)]"
              />
            </div>
            <Show when={value().v1.length}>
              <div class="text-[11.5px] text-faint">
                CLI plugins in caimex.json (v1, not loaded by this app's daemon): {value().v1.join(", ")}
              </div>
            </Show>
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-mono text-[10.5px] text-faint" title={value().file}>
                {value().file.replace(/^\/Users\/[^/]+/, "~")}
              </span>
              <button
                disabled={restarting()}
                onClick={() => void restart()}
                classList={{ "bg-text text-bg font-medium": pending(), "border border-line text-text hover:bg-hover": !pending() }}
                class="h-7 shrink-0 rounded-md px-3 text-[12px] disabled:opacity-50"
              >
                {restarting() ? "Restarting…" : pending() ? "Restart daemon to apply" : "Restart daemon"}
              </button>
            </div>
            <div class="text-[11px] text-faint">
              A plugin that fails to load is skipped without an error, so check Library after restarting.
            </div>
          </>
        )}
      </Show>
      <Show when={error()}>
        <div class="text-[12px] text-bad select-text">{error()}</div>
      </Show>
    </div>
  )
}
