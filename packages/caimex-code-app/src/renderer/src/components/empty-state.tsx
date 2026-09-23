import { Logo } from "@opencode-ai/ui/logo"

export function EmptyState() {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-5 px-8">
      <Logo class="w-[300px] opacity-90" />
      <p class="text-[13px] text-muted">Pick a session from the sidebar.</p>
    </div>
  )
}
