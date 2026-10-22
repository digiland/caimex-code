// Caimex: the "CAIMEx" wordmark. Capitals drawn with heavy box-drawing strokes (square
// corners, open terminals), and a lowercase x that sits on the baseline, built from the same
// strokes and drawn in the accent colour. `left` is "CAIME", `right` the x; rows line up.
export const logo = {
  left: [
    "┏━━━╸ ┏━━━┓ ╻ ┏━━┳━━┓ ┏━━━╸",
    "┃     ┣━━━┫ ┃ ┃  ┃  ┃ ┣━━╸ ",
    "┃     ┃   ┃ ┃ ┃  ┃  ┃ ┃    ",
    "┗━━━╸ ╹   ╹ ╹ ╹  ╹  ╹ ┗━━━╸",
  ],
  right: ["   ", "   ", "┗┳┛", "┏┻┓"],
}

/** The same wordmark one row shorter, for narrower terminals. */
export const compact = {
  left: ["┏━━╸ ┏━━┓ ╻ ┏━┳━┓ ┏━━╸", "┃    ┣━━┫ ┃ ┃ ┃ ┃ ┣━╸ ", "┗━━╸ ╹  ╹ ╹ ╹ ╹ ╹ ┗━━╸"],
  right: ["   ", "┗┳┛", "┏┻┓"],
}

/** Caimex: the "Cx" monogram, where there is no room for the word. */
export const mark = ["┏━━╸    ", "┃    ┗┳┛", "┗━━╸ ┏┻┓"]

// Upstream's "GO" letters, drawn only by the OpenCode Go upsell art (go-upsell-art.ts).
export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}
