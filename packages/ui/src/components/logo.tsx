import { type ComponentProps } from "solid-js"

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

// Caimex Desktop: the "CAIMEx" wordmark, matching the terminal one (packages/tui/src/logo.ts).
/**
 * Capitals are thin circuit traces: one 3-unit stroke along a centreline, rounded corners
 * (radius 4.5), open ends, on a 36-unit cap height. The lowercase x is two traces crossing
 * on the baseline, half the cap height. Each glyph is drawn from its own left edge; letters
 * sit 8 apart, so the word spans 159 units.
 */
export const glyphs = {
  C: { width: 22, trace: "M22 1.5H6A4.5 4.5 0 0 0 1.5 6V30A4.5 4.5 0 0 0 6 34.5H22" },
  A: { width: 22, trace: "M1.5 36V6A4.5 4.5 0 0 1 6 1.5H16A4.5 4.5 0 0 1 20.5 6V36M1.5 18H20.5" },
  I: { width: 3, trace: "M1.5 0V36" },
  M: { width: 34, trace: "M1.5 36V6A4.5 4.5 0 0 1 6 1.5H28A4.5 4.5 0 0 1 32.5 6V36M17 1.5V36" },
  E: { width: 22, trace: "M22 1.5H6A4.5 4.5 0 0 0 1.5 6V30A4.5 4.5 0 0 0 6 34.5H22M1.5 18H17" },
  x: { width: 16, trace: "M0 18L16 36M16 18L0 36" },
} as const satisfies Record<string, { width: number; trace: string }>

export type Glyph = keyof typeof glyphs
export const word: Glyph[] = ["C", "A", "I", "M", "E", "x"]
/** Where each letter of `word` starts. */
export const offsets = word.reduce<number[]>(
  (xs, _, index) => [...xs, index === 0 ? 0 : xs[index - 1] + glyphs[word[index - 1]].width + 8],
  [],
)
export const stroke = 3

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 159 36"
      fill="none"
      role="img"
      aria-label="CAIMEx"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {word.map((letter, index) => (
        <path
          d={glyphs[letter].trace}
          transform={`translate(${offsets[index]} 0)`}
          // The x takes the accent colour.
          stroke={letter === "x" ? "var(--icon-interactive-base)" : "var(--icon-strong-base)"}
          stroke-width={stroke}
        />
      ))}
    </svg>
  )
}
