import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { glyphPath, glyphWidth, offsets, word, wordWidth } from "@opencode/ui/logo"
import { prefersReducedMotion } from "@opencode/ui/motion"

// Caimex Desktop: "CAIMEx", in the glyphs of @opencode/ui's Logo.
const target = word

// A slot only cycles through letters no wider than its own, so the scramble never overlaps a neighbour.
const choices = target.map((letter) => word.filter((other) => glyphWidth(other) <= glyphWidth(letter)))
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

        if (!active || prefersReducedMotion()) {
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
    <svg
      class="settings-about-wordmark"
      viewBox={`0 0 ${wordWidth} 10`}
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      <For each={state.letters}>
        {(letter, index) => (
          // Centred in its slot while it scrambles; a settled letter fills the slot exactly.
          <path d={glyphPath(letter, offsets[index()] + (glyphWidth(target[index()]) - glyphWidth(letter)) / 2)} />
        )}
      </For>
    </svg>
  )
}
