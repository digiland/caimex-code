import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { type Glyph, glyphs, offsets, stroke, word } from "@opencode/ui/logo"

// Caimex Desktop: "CAIMEx", in the glyphs of @opencode/ui's Logo.
const target = word

// A slot only cycles through letters no wider than its own, so the scramble never overlaps a neighbour.
const choices = target.map((letter) =>
  (Object.keys(glyphs) as Glyph[]).filter((other) => glyphs[other].width <= glyphs[letter].width),
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
    <svg class="settings-about-wordmark" viewBox="0 0 163 36" aria-hidden="true">
      <For each={state.letters}>
        {(letter, index) => {
          const glyph = glyphs[letter]
          // Centred in its slot while it scrambles; a settled letter fills the slot exactly.
          const x = offsets[index()] + (glyphs[target[index()]].width - glyph.width) / 2
          return "trace" in glyph ? (
            <path
              d={glyph.trace}
              transform={`translate(${x} 0)`}
              fill="none"
              stroke="currentColor"
              stroke-width={stroke}
            />
          ) : (
            <path d={glyph.solid} transform={`translate(${x} 0)`} />
          )
        }}
      </For>
    </svg>
  )
}
