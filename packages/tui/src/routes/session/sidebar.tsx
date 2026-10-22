import { useData } from "../../context/data"
import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { type Reaction, Robot } from "../../component/logo"
import type { Face } from "../../logo"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { Slot } from "../../plugin/render"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { TextAttributes } from "@opentui/core"
import "../../component/title-shimmer"

import { getScrollAcceleration } from "../../util/scroll"
import { SESSION_SIDEBAR_WIDTH } from "../../ui/layout"

// Caimex: the robot keeps the session company. It thinks while a turn runs, looks up when the
// session needs an answer, smiles when a turn finishes and is sad when one fails.
function SessionRobot(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme()
  const running = () => data.session.status(props.sessionID) === "running"
  const waiting = () =>
    (data.session.permission.list(props.sessionID) ?? []).length > 0 ||
    (data.session.form.list(props.sessionID) ?? []).length > 0
  const outcome = () => {
    const last = data.session.message.list(props.sessionID).findLast((message) => message.type === "idle")
    return last?.type === "idle" ? last.outcome : undefined
  }
  const mood = (): Face => (waiting() ? "surprised" : running() ? "thinking" : outcome() === "failed" ? "sad" : "idle")
  const [reaction, setReaction] = createSignal<Reaction>()
  createEffect(
    on(running, (now, before) => {
      if (before && !now && outcome() === "succeeded") setReaction({ face: "happy", at: Date.now() })
    }),
  )
  const caption = () =>
    waiting() ? "Needs you" : running() ? "Working…" : outcome() === "failed" ? "That didn't work" : "Ready"

  return (
    <box flexDirection="row" gap={2} alignItems="center">
      <Robot mood={mood()} reaction={reaction()} />
      <text fg={waiting() ? theme.text.feedback.warning.base : theme.text.muted}>{caption()}</text>
    </box>
  )
}

export function Sidebar(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme()
  const config = useConfig().data
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.background.raised.base}
        width={SESSION_SIDEBAR_WIDTH}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position="relative"
      >
        <box flexShrink={0} paddingRight={2} paddingBottom={1}>
          <title_shimmer
            fg={theme.text.base}
            rename={{
              pending: data.session.title.pending(props.sessionID),
              title: withTimestampedFallback(session()),
            }}
            enabled={config.animations ?? true}
            backdrop={theme.background.raised.base}
            attributes={
              data.session.title.pending(props.sessionID) && config.animations === false
                ? TextAttributes.DIM
                : TextAttributes.BOLD
            }
          >
            {withTimestampedFallback(session())}
          </title_shimmer>
        </box>
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={scrollAcceleration()}
          // The sidebar only scrolls vertically; a horizontal bar steals a row during initial layout.
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{
            // Use the content's reserved right padding instead of changing its width when the bar toggles.
            position: "absolute",
            right: 0,
            top: 0,
            width: 1,
            height: "100%",
            trackOptions: {
              backgroundColor: theme.background.raised.base,
              foregroundColor: theme.scrollbar.base,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <Slot path="sidebar.content" input={{ sessionID: props.sessionID }} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <SessionRobot sessionID={props.sessionID} />
          <Slot path="sidebar.footer" input={{ sessionID: props.sessionID }} />
        </box>
      </box>
    </Show>
  )
}
