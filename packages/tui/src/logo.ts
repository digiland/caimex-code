// Caimex: the "CAIMEx" wordmark and the robot that sits beside it.
//
// The letters are a heavy rounded face drawn on a pixel grid, 10 pixels tall, then folded into
// half-blocks (two pixels per terminal row), so the word is 5 rows tall. `#` is ink.
const glyphs: Record<string, string[]> = {
  C: [
    "..######",
    ".#######",
    "###.....",
    "##......",
    "##......",
    "##......",
    "##......",
    "###.....",
    ".#######",
    "..######",
  ],
  A: [
    "..####..",
    ".######.",
    "###..###",
    "##....##",
    "########",
    "########",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
  ],
  I: Array(10).fill("##"),
  M: [
    "###....###",
    "####..####",
    "##.####.##",
    "##..##..##",
    "##......##",
    "##......##",
    "##......##",
    "##......##",
    "##......##",
    "##......##",
  ],
  E: [
    ".#######",
    "########",
    "##......",
    "##......",
    "#######.",
    "#######.",
    "##......",
    "##......",
    "########",
    ".#######",
  ],
  // Lowercase: sits on the baseline, 6 pixels tall.
  x: [...Array(4).fill("......"), "##..##", ".####.", "..##..", "..##..", ".####.", "##..##"],
}

const halves: Record<string, string> = { "##": "█", "#.": "▀", ".#": "▄", "..": " " }

/** Pixel rows → terminal rows: each pair of pixel rows becomes one row of half-blocks. */
function fold(pixels: string[]) {
  return Array.from({ length: pixels.length / 2 }, (_, row) =>
    Array.from(pixels[row * 2], (top, column) => halves[top + pixels[row * 2 + 1][column]]).join(""),
  )
}

function spell(text: string) {
  return fold(Array.from({ length: 10 }, (_, row) => Array.from(text, (letter) => glyphs[letter][row]).join("..")))
}

/** "CAIME" in `left`, the x in `right`: 5 rows each, drawn with a gap of one column. */
export const logo = { left: spell("CAIME"), right: spell("x") }

/**
 * The robot's faces: eyes, then mouth, each 5 columns, drawn on the visor. The visor is the part of
 * a `robot()` row between `{` and `}`; callers draw it on a dark background.
 */
export const faces = {
  idle: ["●   ●", " ╰─╯ "],
  blink: ["─   ─", " ╰─╯ "],
  happy: ["^   ^", " ╰▽╯ "],
  wink: ["●   ─", " ╰─╯ "],
  thinking: ["  ● ●", "  ~  "],
  surprised: ["◉   ◉", "  o  "],
  sad: ["●   ●", " ╭─╮ "],
} as const

export type Face = keyof typeof faces

/** The robot, 11 columns by 5 rows, wearing `face`. */
export function robot(face: Face = "idle") {
  const [eyes, mouth] = faces[face]
  return ["    ▄█▄    ", " ▄▀▀▀▀▀▀▀▄ ", `▐█{ ${eyes} }█▌`, `▐█{ ${mouth} }█▌`, " ▀▄▄▄▄▄▄▄▀ "]
}

/** The robot as plain text (visor markers removed), where one colour is all there is: the monogram. */
export const mark = robot().map((line) => line.replace(/[{}]/g, ""))

// Upstream's "GO" letters, drawn only by the OpenCode Go upsell art (go-upsell-art.ts).
export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}
