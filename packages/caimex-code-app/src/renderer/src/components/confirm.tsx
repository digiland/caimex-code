import { createSignal, onCleanup, onMount, Show } from "solid-js"

// The one way the app asks "are you sure" or reports a failed action, in the app's own
// styling. Opens focused on the main button: Enter confirms, Esc or a click outside
// cancels. Call `ask` from anywhere; `ConfirmHost` is mounted once at the shell.

type Request = {
  message: string
  detail?: string
  confirm: string
  danger?: boolean
  // An alert has no cancel: it only acknowledges.
  alert?: boolean
  resolve: (confirmed: boolean) => void
}

const [request, setRequest] = createSignal<Request>()

export function ask(input: { message: string; detail?: string; confirm?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) =>
    setRequest({ ...input, confirm: input.confirm ?? "OK", resolve }),
  )
}

export function notify(input: { message: string; detail?: string }) {
  return new Promise<void>((resolve) =>
    setRequest({ ...input, confirm: "OK", alert: true, resolve: () => resolve() }),
  )
}

export function ConfirmHost() {
  return <Show when={request()}>{(current) => <Dialog request={current()} />}</Show>
}

function Dialog(props: { request: Request }) {
  let primary!: HTMLButtonElement
  const close = (confirmed: boolean) => {
    // Read before clearing: clearing unmounts this dialog, and props.request with it.
    const { resolve } = props.request
    setRequest(undefined)
    resolve(confirmed)
  }
  onMount(() => {
    primary.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close(false)
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
      onMouseDown={(event) => event.target === event.currentTarget && close(false)}
    >
      <div
        role="alertdialog"
        aria-label={props.request.message}
        class="w-full max-w-[400px] rounded-2xl border border-line bg-elevated p-5 shadow-[0_20px_60px_rgb(0_0_0/0.35)]"
      >
        <div class="text-[14px] font-medium text-text">{props.request.message}</div>
        <Show when={props.request.detail}>
          <div class="mt-1.5 text-[12.5px] leading-relaxed text-muted select-text">{props.request.detail}</div>
        </Show>
        <div class="mt-5 flex justify-end gap-2">
          <Show when={!props.request.alert}>
            <button
              onClick={() => close(false)}
              class="h-8 rounded-md px-3.5 text-[12.5px] text-muted hover:bg-hover hover:text-text"
            >
              Cancel
            </button>
          </Show>
          <button
            ref={primary}
            onClick={() => close(true)}
            classList={{
              "bg-bad text-white": !!props.request.danger,
              "bg-text text-bg": !props.request.danger,
            }}
            class="h-8 rounded-md px-3.5 text-[12.5px] font-medium outline-offset-2"
          >
            {props.request.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
