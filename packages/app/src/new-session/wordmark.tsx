import { createSignal, onCleanup } from "solid-js"
import { Logo, Robot, type RobotFace } from "@opencode/ui/logo"
import "./wordmark.css"

/**
 * Caimex Desktop: the robot's face. It rests on `mood` (what the screen around it is doing) and
 * now and then blinks, smiles, winks or glances aside; `poke` surprises it.
 */
function useRobotFace(mood: () => RobotFace) {
  const [passing, setPassing] = createSignal<RobotFace>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const show = (face: RobotFace, ms: number) => {
    setPassing(face)
    const timer = setTimeout(() => {
      timers.delete(timer)
      setPassing(undefined)
    }, ms)
    timers.add(timer)
  }
  let tick = 0
  const loop = setInterval(() => {
    tick += 1
    if (mood() !== "idle") return show("blink", 150)
    if (tick % 7 === 0) return show("happy", 1400)
    if (tick % 11 === 0) return show("wink", 700)
    if (tick % 13 === 0) return show("thinking", 1600)
    show("blink", 150)
  }, 3200)
  onCleanup(() => {
    clearInterval(loop)
    timers.forEach(clearTimeout)
  })
  return { face: () => passing() ?? mood(), poke: () => show("surprised", 900) }
}

export function NewSessionWordmark(props: { mood?: RobotFace }) {
  const robot = useRobotFace(() => props.mood ?? "idle")
  return (
    <div
      data-component="new-session-wordmark"
      class="mx-auto flex w-full max-w-[720px] items-center justify-center gap-5 text-v2-background-bg-inverse"
    >
      <button type="button" class="shrink-0 cursor-default" aria-label="Caimex robot" onClick={robot.poke}>
        <Robot face={robot.face()} class="block h-16 w-auto" />
      </button>
      <div data-slot="wordmark-reveal" aria-hidden="true" class="pointer-events-none relative w-[300px]">
        <Logo class="block aspect-[52/10] w-full opacity-[0.16]" />
        <Logo class="wordmark-shimmer absolute inset-0 aspect-[52/10] w-full" />
      </div>
    </div>
  )
}
