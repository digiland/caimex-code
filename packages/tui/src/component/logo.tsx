import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { compact, logo, mark } from "../logo"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background.base, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  // Caimex: "CAIME" in the text colour, the lowercase x in the accent; the wordmark loses a row
  // when the terminal is narrower, and becomes the "Cx" monogram when the word doesn't fit.
  const word = (mark: { left: string[]; right: string[] }) => (
    <For each={mark.left}>
      {(line, index) => (
        <box flexDirection="row" gap={1}>
          <box flexDirection="row">{renderLine(line, theme.text.base, true)}</box>
          <box flexDirection="row">{renderLine(mark.right[index()] ?? "", theme.text.action.primary.base, true)}</box>
        </box>
      )}
    </For>
  )

  return (
    <box>
      {dimensions().height < 12 ? null : dimensions().width < 30 ? (
        <For each={mark}>
          {(line) => <box flexDirection="row">{renderLine(line, theme.text.base, true)}</box>}
        </For>
      ) : dimensions().width < 50 ? (
        word(compact)
      ) : (
        word(logo)
      )}
    </box>
  )
}
