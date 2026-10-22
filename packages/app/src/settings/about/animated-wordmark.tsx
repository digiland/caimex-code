import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

// Caimex Desktop: "CAIMEx", in the glyphs of @opencode/ui's Logo (one 5-unit stroke, cap height 36).
// Each glyph is drawn from its own left edge; `x` is where its slot starts in the 165-unit word.
const glyphs = {
  C: { width: 22, d: "M22 5H5V31H22V36H0V0H22V5Z" },
  A: { width: 22, d: "M0 36V0H22V36H17V19.5H5V36H0ZM5 5V14.5H17V5H5Z" },
  I: { width: 5, d: "M0 0H5V36H0V0Z" },
  M: { width: 34, d: "M0 36V0H34V36H29V5H19.5V36H14.5V5H5V36H0Z" },
  E: { width: 22, d: "M22 5H5V14.5H17V19.5H5V31H22V36H0V0H22V5Z" },
  x: { width: 20, d: "M0 16H5V20H15V16H20V25H12.5V27H20V36H15V32H5V36H0V27H7.5V25H0V16Z" },
} as const

type Letter = keyof typeof glyphs

const target: Letter[] = ["C", "A", "I", "M", "E", "x"]
const slots = target.reduce<number[]>(
  (xs, letter, index) => [...xs, index === 0 ? 0 : xs[index - 1] + glyphs[target[index - 1]].width + 8],
  [],
)

// A slot only cycles through letters no wider than its own, so the scramble never overlaps a neighbour.
const choices = target.map((letter) =>
  (Object.keys(glyphs) as Letter[]).filter((other) => glyphs[other].width <= glyphs[letter].width),
)
const pick = (index: number) => choices[index][Math.floor(Math.random() * choices[index].length)]

export function AnimatedWordmark(props: { active: boolean }) {
  const [state, setState] = createStore({ letters: [...target] })
  const timers = new Set<ReturnType<typeof setTimeout>>()

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()

        if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setState("letters", [...target])

          return
        }

        const starts = target.map((_, index) => pick(index))
        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState("letters", starts)

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              target.map((letter, index) => (tick >= settles[index] ? letter : pick(index))),
            )
            timers.delete(timer)
          }, tick * 75)

          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox="0 0 165 36" aria-hidden="true">
      <For each={state.letters}>
        {(letter, index) => {
          // Centred in its slot while it scrambles; a settled letter fills the slot exactly.
          const slot = target[index()]
          return (
            <path
              fill-rule="evenodd"
              d={glyphs[letter].d}
              transform={`translate(${slots[index()] + (glyphs[slot].width - glyphs[letter].width) / 2} 0)`}
            />
          )
        }}
      </For>
    </svg>
  )
}
