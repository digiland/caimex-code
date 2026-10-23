import { Show } from "solid-js"
import type { Model } from "../api"
import { modelName } from "../format"

export type Gateway = { providers: string[]; models: number; defaultModel: Model | undefined }

export function Status(props: {
  online: boolean | undefined
  live: boolean
  signedIn: boolean | undefined
  gateway: Gateway | undefined
  error: string | undefined
}) {
  const state = () => {
    if (props.online === false) return { tone: "bg-bad", label: "Daemon offline" }
    if (props.error) return { tone: "bg-bad", label: "Gateway unavailable" }
    if (!props.gateway) return { tone: "bg-faint", label: "Connecting…" }
    if (!props.gateway.providers.includes("caimex")) return { tone: "bg-warn", label: "Caimex not connected" }
    // The daemon lists Caimex even before login, so the account decides this.
    if (props.signedIn === false) return { tone: "bg-warn", label: "Not signed in" }
    if (!props.live) return { tone: "bg-warn", label: "Reconnecting live updates…" }
    return { tone: "bg-ok", label: "Caimex gateway" }
  }

  return (
    <div class="flex items-start gap-2.5 px-1" title={props.error}>
      <span class={`mt-[5px] size-2 shrink-0 rounded-full ${state().tone}`} />
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] text-text">{state().label}</div>
        <Show when={props.gateway?.providers.includes("caimex") && props.gateway}>
          {(gateway) => (
            <div class="truncate text-[11px] text-faint">
              {gateway().models} models
              <Show when={gateway().defaultModel}>{(model) => <> · {modelName(model().id)}</>}</Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
