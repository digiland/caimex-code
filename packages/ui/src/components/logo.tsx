import { createUniqueId, type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

// Caimex Desktop: the "CAIMEx" wordmark and its robot, matching the terminal ones
// (packages/tui/src/logo.ts, whose pixel letters these are; keep the two in step).
/**
 * The letters are a heavy rounded face on a pixel grid, 10 pixels tall (`#` is ink); one SVG
 * unit is one pixel. Letters sit 2 apart; the lowercase x sits on the baseline.
 */
const pixels = {
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
  I: ["##", "##", "##", "##", "##", "##", "##", "##", "##", "##"],
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
  x: ["......", "......", "......", "......", "##..##", ".####.", "..##..", "..##..", ".####.", "##..##"],
} as const

export type Glyph = keyof typeof pixels
export const word: Glyph[] = ["C", "A", "I", "M", "E", "x"]
export const glyphWidth = (letter: Glyph) => pixels[letter][0].length
/** Where each letter of `word` starts. */
export const offsets = word.reduce<number[]>(
  (xs, _, index) => [...xs, index === 0 ? 0 : xs[index - 1] + glyphWidth(word[index - 1]) + 2],
  [],
)
export const wordWidth = offsets[offsets.length - 1] + glyphWidth("x")

/** One letter as a path: each run of ink in a row becomes a rectangle, starting at `x`. */
export function glyphPath(letter: Glyph, x = 0) {
  return pixels[letter]
    .flatMap((row, y) =>
      Array.from(row.matchAll(/#+/g), (run) => `M${x + run.index} ${y}h${run[0].length}v1h-${run[0].length}Z`),
    )
    .join("")
}

export const Logo = (props: { class?: string }) => {
  const id = createUniqueId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${wordWidth} 10`}
      fill="none"
      role="img"
      aria-label="CAIMEx"
      shape-rendering="crispEdges"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <defs>
        {/* Brushed metal: full strength at the top, fading toward the base colour. */}
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--icon-strong-base)" />
          <stop offset="1" stop-color="var(--icon-base)" />
        </linearGradient>
      </defs>
      <path
        d={word
          .slice(0, -1)
          .map((letter, index) => glyphPath(letter, offsets[index]))
          .join("")}
        fill={`url(#${id})`}
      />
      <path d={glyphPath("x", offsets[word.length - 1])} fill="var(--icon-interactive-base)" />
    </svg>
  )
}

/** The robot's faces, as in the terminal. */
export type RobotFace = "idle" | "blink" | "happy" | "wink" | "thinking" | "surprised"

const eye = {
  open: (x: number) => <circle cx={x} cy="21" r="2.6" />,
  shut: (x: number) => <path d={`M${x - 3} 21h6`} stroke-width="2" stroke-linecap="round" />,
  smile: (x: number) => (
    <path d={`M${x - 3} 22.5l3-3 3 3`} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  ),
  glance: (x: number) => <circle cx={x + 2.5} cy="20" r="2.2" />,
  wide: (x: number) => (
    <>
      <circle cx={x} cy="21" r="3.6" fill="none" stroke-width="1.6" />
      <circle cx={x} cy="21" r="1.4" />
    </>
  ),
}

const faceParts: Record<RobotFace, { eyes: [keyof typeof eye, keyof typeof eye]; mouth: string }> = {
  idle: { eyes: ["open", "open"], mouth: "M17 27q5 3.5 10 0" },
  blink: { eyes: ["shut", "shut"], mouth: "M17 27q5 3.5 10 0" },
  happy: { eyes: ["smile", "smile"], mouth: "M16 26.5q6 5.5 12 0z" },
  wink: { eyes: ["open", "shut"], mouth: "M17 27q5 3.5 10 0" },
  thinking: { eyes: ["glance", "glance"], mouth: "M18 28q2-1.5 4 0t4 0" },
  surprised: { eyes: ["wide", "wide"], mouth: "M22 26.2a1.9 1.9 0 1 0 .01 0" },
}

/**
 * The robot: a metal head with an antenna and a dark visor whose face glows. `face` picks the
 * expression; the caller decides when it changes.
 */
export const Robot = (props: { class?: string; face?: RobotFace }) => {
  const parts = () => faceParts[props.face ?? "idle"]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 44 40"
      role="img"
      aria-label="Caimex robot"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <path d="M22 3v6" stroke="var(--icon-base)" stroke-width="2" stroke-linecap="round" />
      <circle cx="22" cy="3" r="2.4" fill="var(--icon-interactive-base)" />
      <rect x="2" y="16" width="5" height="12" rx="2" fill="var(--icon-base)" />
      <rect x="37" y="16" width="5" height="12" rx="2" fill="var(--icon-base)" />
      <rect x="5" y="9" width="34" height="28" rx="9" fill="var(--icon-strong-base)" />
      <rect x="9" y="13" width="26" height="20" rx="6" fill="#0c1222" />
      <g fill="#50dcff" stroke="#50dcff">
        {eye[parts().eyes[0]](16)}
        {eye[parts().eyes[1]](28)}
        <path
          d={parts().mouth}
          fill={props.face === "happy" || props.face === "surprised" ? "#50dcff" : "none"}
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </g>
    </svg>
  )
}
