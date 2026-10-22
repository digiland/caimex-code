import { createEffect, createMemo, createSignal, on } from "solid-js"
import { Robot, type RobotFace } from "@opencode/ui/logo"
import { type RobotReaction, useRobotFace } from "@/new-session/wordmark"
import type { SessionModel } from "../model"

/**
 * Caimex Desktop: the robot keeps the session company beside the composer. It thinks while a turn
 * runs, looks up when the session needs an answer, smiles when a turn finishes and is sad when one
 * fails.
 */
export function SessionRobot(props: { session: SessionModel }) {
  const data = () => props.session.shared.data
  const id = () => props.session.identity.sessionID()
  const running = () => props.session.data.working()
  const waiting = () => {
    const sessionID = id()
    if (!sessionID) return false
    return (
      (data().session.permission.list(sessionID) ?? []).length > 0 ||
      (data().session.form.list(sessionID) ?? []).length > 0
    )
  }
  const outcome = createMemo(() => {
    const last = props.session.history.messages().findLast((message) => message.type === "idle")
    return last?.type === "idle" ? last.outcome : undefined
  })
  const mood = (): RobotFace =>
    waiting() ? "surprised" : running() ? "thinking" : outcome() === "failed" ? "sad" : "idle"
  const [reaction, setReaction] = createSignal<RobotReaction>()
  createEffect(
    on(running, (now, before) => {
      if (before && !now && outcome() === "succeeded") setReaction({ face: "happy", at: Date.now() })
    }),
  )
  const robot = useRobotFace(mood, reaction)
  const label = () =>
    waiting() ? "Needs your answer" : running() ? "Working" : outcome() === "failed" ? "The last turn failed" : "Ready"

  return (
    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center"
      title={label()}
      aria-label={label()}
      onClick={robot.poke}
    >
      <Robot face={robot.face()} class="h-6 w-auto" />
    </button>
  )
}
