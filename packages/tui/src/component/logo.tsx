import { RGBA, TextAttributes } from "@opentui/core"
import { createEffect, createSignal, For, on, onCleanup, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { type Face, logo, robot } from "../logo"

// Caimex: the robot's visor is a dark screen in every theme; its face glows on it.
const visor = RGBA.fromHex("#0c1222")
const glow = RGBA.fromHex("#50dcff")

/** A one-off look; each new `at` plays it again. */
export type Reaction = { face: Face; at: number; ms?: number }

/**
 * The robot. It rests on `mood` (what the screen around it is doing) and now and then blinks,
 * smiles, winks or glances aside; each `reaction` plays once, and a click surprises it.
 */
export function Robot(props: { mood?: Face; reaction?: Reaction }) {
  const theme = useTheme()
  const mood = () => props.mood ?? "idle"
  const [passing, setPassing] = createSignal<Face>()
  const face = () => passing() ?? mood()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const show = (next: Face, ms: number) => {
    setPassing(next)
    const timer = setTimeout(() => {
      timers.delete(timer)
      setPassing(undefined)
    }, ms)
    timers.add(timer)
  }
  let tick = 0
  const loop = setInterval(() => {
    tick += 1
    // Busy with something: just blink.
    if (mood() !== "idle") return show("blink", 150)
    if (tick % 7 === 0) return show("happy", 1400)
    if (tick % 11 === 0) return show("wink", 700)
    if (tick % 13 === 0) return show("thinking", 1600)
    show("blink", 150)
  }, 3200)
  createEffect(
    on(
      () => props.reaction,
      (reaction) => reaction && show(reaction.face, reaction.ms ?? 2500),
      { defer: true },
    ),
  )
  onCleanup(() => {
    clearInterval(loop)
    timers.forEach(clearTimeout)
  })

  const metal = (row: number) => tint(theme.text.muted, theme.text.base, 1 - row * 0.18)
  const head = (row: number): JSX.Element => {
    const line = robot(face())[row]
    const open = line.indexOf("{")
    if (open < 0)
      return (
        <text fg={metal(row)} selectable={false}>
          {line}
        </text>
      )
    const close = line.indexOf("}")
    return (
      <box flexDirection="row">
        <text fg={metal(row)} selectable={false}>
          {line.slice(0, open)}
        </text>
        <text fg={glow} bg={visor} attributes={TextAttributes.BOLD} selectable={false}>
          {line.slice(open + 1, close)}
        </text>
        <text fg={metal(row)} selectable={false}>
          {line.slice(close + 1)}
        </text>
      </box>
    )
  }

  return (
    <box onMouseDown={() => show("surprised", 900)}>
      <For each={[0, 1, 2, 3, 4]}>{(row) => head(row)}</For>
    </box>
  )
}

export function Logo(props: { mood?: Face }) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  // Brushed metal: the text colour at the top, fading toward muted at the bottom.
  const metal = (row: number) => tint(theme.text.muted, theme.text.base, 1 - row * 0.18)

  const word = (row: number): JSX.Element => (
    <box flexDirection="row" gap={1}>
      <text fg={metal(row)} attributes={TextAttributes.BOLD} selectable={false}>
        {logo.left[row]}
      </text>
      <text fg={theme.text.action.primary.base} attributes={TextAttributes.BOLD} selectable={false}>
        {logo.right[row]}
      </text>
    </box>
  )

  const rows = [0, 1, 2, 3, 4]
  const width = () => dimensions().width

  return (
    <box>
      {dimensions().height < 12 ? null : width() >= 72 ? (
        // The robot beside the word.
        <box flexDirection="row" gap={3}>
          <Robot mood={props.mood} />
          <box>
            <For each={rows}>{(row) => word(row)}</For>
          </box>
        </box>
      ) : width() >= 58 ? (
        <For each={rows}>{(row) => word(row)}</For>
      ) : (
        // No room for the word: the robot, with the name in plain text beside it.
        <box flexDirection="row" gap={2} alignItems="center">
          <Robot mood={props.mood} />
          {width() >= 24 ? (
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} selectable={false}>
              CAIMEx
            </text>
          ) : null}
        </box>
      )}
    </box>
  )
}
