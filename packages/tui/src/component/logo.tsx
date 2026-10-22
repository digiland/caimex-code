import { RGBA, TextAttributes } from "@opentui/core"
import { createSignal, For, onCleanup, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { type Face, logo, robot } from "../logo"

// Caimex: the robot's visor is a dark screen in every theme; its face glows on it.
const visor = RGBA.fromHex("#0c1222")
const glow = RGBA.fromHex("#50dcff")

/** Now and then the robot blinks, smiles, winks or glances aside; a click surprises it. */
function useFace() {
  const [face, setFace] = createSignal<Face>("idle")
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const show = (next: Face, ms: number) => {
    setFace(next)
    const timer = setTimeout(() => {
      timers.delete(timer)
      setFace("idle")
    }, ms)
    timers.add(timer)
  }
  let tick = 0
  const loop = setInterval(() => {
    tick += 1
    if (tick % 7 === 0) return show("happy", 1400)
    if (tick % 11 === 0) return show("wink", 700)
    if (tick % 13 === 0) return show("thinking", 1600)
    show("blink", 150)
  }, 3200)
  onCleanup(() => {
    clearInterval(loop)
    timers.forEach(clearTimeout)
  })
  return { face, poke: () => show("surprised", 900) }
}

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const { face, poke } = useFace()

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

  const rows = [0, 1, 2, 3, 4]
  const width = () => dimensions().width
  const robotBox = () => (
    <box onMouseDown={poke}>
      <For each={rows}>{(row) => head(row)}</For>
    </box>
  )

  return (
    <box>
      {dimensions().height < 12 ? null : width() >= 72 ? (
        // The robot beside the word.
        <box flexDirection="row" gap={3}>
          {robotBox()}
          <box>
            <For each={rows}>{(row) => word(row)}</For>
          </box>
        </box>
      ) : width() >= 58 ? (
        <For each={rows}>{(row) => word(row)}</For>
      ) : (
        // No room for the word: the robot, with the name in plain text beside it.
        <box flexDirection="row" gap={2} alignItems="center">
          {robotBox()}
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
