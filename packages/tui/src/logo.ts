// Caimex: the "CAIMEx" wordmark. Capitals drawn as thin circuit traces (rounded corners,
// open ends), and a lowercase x of 45° wedges sitting on the baseline, drawn in the accent
// colour. `left` is "CAIME", `right` the x; rows line up.
export const logo = {
  left: [
    "╭───╴ ╭───╮ ╷ ╭─┬─╮ ╭───╴",
    "│     ├───┤ │ │ │ │ ├──╴ ",
    "│     │   │ │ │ │ │ │    ",
    "╰───╴ ╵   ╵ ╵ ╵ ╵ ╵ ╰───╴",
  ],
  right: ["    ", "    ", "◥◣◢◤", "◢◤◥◣"],
}

/** The same wordmark one row shorter, for narrower terminals. */
export const compact = {
  left: ["╭──╴ ╭──╮ ╷ ╭─┬─╮ ╭──╴", "│    ├──┤ │ │ │ │ ├─╴ ", "╰──╴ ╵  ╵ ╵ ╵ ╵ ╵ ╰──╴"],
  right: ["    ", "◥◣◢◤", "◢◤◥◣"],
}

/** Caimex: the "Cx" monogram, where there is no room for the word. */
export const mark = ["╭──╴     ", "│    ◥◣◢◤", "╰──╴ ◢◤◥◣"]

// Upstream's "GO" letters, drawn only by the OpenCode Go upsell art (go-upsell-art.ts).
export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}
