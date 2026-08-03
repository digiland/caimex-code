import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { isVersionGreater, UPDATE_AVAILABLE_KEY, UPDATE_INSTALLED_KEY } from "../../util/version"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const paths = useTuiPaths()
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  // A newer release exists but this process is still on the old build. Set by
  // app.tsx from installation.update-available, and it survives dismissing the
  // update prompt — that dialog only fires once per launch.
  const newerThanRunning = (key: string) => {
    const version = props.api.kv.get<string | undefined>(key)
    return version && isVersionGreater(version, props.api.app.version) ? version : undefined
  }
  const available = createMemo(() => newerThanRunning(UPDATE_AVAILABLE_KEY))
  // Auto-update already swapped the binary on disk; the new build only takes
  // effect on restart, so this outranks the "available" hint.
  const installed = createMemo(() => newerThanRunning(UPDATE_INSTALLED_KEY))
  const path = createMemo(() => {
    const session = props.api.state.session.get(props.sessionID)
    const dir = session?.directory || props.api.state.path.directory || paths.cwd
    const out = abbreviateHome(dir, paths.home)
    const branch = session?.directory === props.api.state.path.directory ? props.api.state.vcs?.branch : undefined
    const text = branch ? out + ":" + branch : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>Caimex Code includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme().text }}>{path().name}</span>
      </text>
      {/* Wordmark and update hint sit flush against each other, so this box
          opts out of the surrounding gap. */}
      <box>
        <text fg={theme().textMuted}>
          <span style={{ fg: installed() || available() ? theme().warning : theme().success }}>•</span> <b>Caimex</b>
          <span style={{ fg: theme().text }}>
            <b>Code</b>
          </span>{" "}
          <span>{props.api.app.version}</span>
        </text>
        {/* The sidebar is narrow, so the hint and its call to action get a line
            each rather than risking a mid-phrase wrap. */}
        <Show when={installed()}>
          {(version) => (
            <>
              <text fg={theme().warning}>⬆ v{version()} installed</text>
              <text fg={theme().textMuted}>restart to apply</text>
            </>
          )}
        </Show>
        <Show when={installed() ? undefined : available()}>
          {(version) => (
            <>
              <text fg={theme().warning}>⬆ v{version()} available</text>
              <text fg={theme().textMuted}>run caimex upgrade</text>
            </>
          )}
        </Show>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
