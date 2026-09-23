import { Logo } from "@opencode-ai/ui/logo"
import type { JSX } from "solid-js"
import { Composer } from "./composer"

export function NewSessionView(props: {
  project: JSX.Element
  controls: JSX.Element
  onSend: (text: string) => Promise<void>
}) {
  return (
    <div class="flex h-full flex-col">
      <div class="drag h-[52px] shrink-0" />
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8">
        <Logo class="w-[260px] opacity-90" />
        <p class="text-[13px] text-muted">What should we work on?</p>
      </div>
      <div class="shrink-0 px-8 pb-2">
        <div class="mx-auto flex max-w-[780px] items-center gap-1 text-[12px] text-faint">
          <span class="pl-2">in</span>
          {props.project}
        </div>
      </div>
      <Composer busy={false} onSend={props.onSend} onStop={async () => {}} controls={props.controls} placeholder="Describe a task…" />
    </div>
  )
}
