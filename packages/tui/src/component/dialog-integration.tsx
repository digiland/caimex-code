import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { IntegrationAttempt, IntegrationInfo, IntegrationMethod } from "@opencode-ai/sdk/v2"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { Link } from "../ui/link"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useData } from "../context/data"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { DialogModel } from "./dialog-model"

// The v2 half of /connect. v2 moved credentials from "auth for a provider" to
// "a connection on an integration", so the whole flow — the list, the method
// picker, the poll — hangs off /api/integration rather than /provider. The v1
// flow lives in dialog-provider.tsx; useBackend() picks between them.

const POLL_INTERVAL_MS = 1_000
// The server's own attempt lifetime governs expiry; this is only a stop for a
// TUI left open against a server that stopped answering.
const POLL_TIMEOUT_MS = 15 * 60 * 1000

const CODE_PATTERN = /[A-Z0-9]{4}-[A-Z0-9]{4,5}/

function methodLabel(method: IntegrationMethod) {
  if (method.type === "oauth") return method.label
  if (method.type === "key") return method.label ?? "API key"
  return `Environment: ${method.names.join(", ")}`
}

export function integrationOptions(list: readonly IntegrationInfo[]) {
  // Only integrations offering a method the TUI can actually drive. `env` is
  // configured outside the app, so selecting it could do nothing.
  return list
    .filter((integration) => integration.methods.some((method) => method.type === "oauth" || method.type === "key"))
    .toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

export function createDialogIntegrationOptions() {
  const data = useData()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()

  return () =>
    integrationOptions(data.location.integration.list() ?? []).map((integration) => ({
      title: integration.name,
      value: integration.id,
      category: "Providers",
      gutter: integration.connections.length ? () => <text fg={theme.success}>✓</text> : undefined,
      async onSelect() {
        const methods = integration.methods.filter(
          (method) => method.type === "oauth" || method.type === "key",
        )

        let index: number | null = 0
        if (methods.length > 1) {
          index = await new Promise<number | null>((resolve) => {
            dialog.replace(
              () => (
                <DialogSelect
                  title="Select auth method"
                  options={methods.map((method, index) => ({ title: methodLabel(method), value: index }))}
                  onSelect={(option) => resolve(option.value)}
                />
              ),
              () => resolve(null),
            )
          })
        }
        if (index === null) return
        const method = methods[index]

        if (method.type === "key") {
          return dialog.replace(() => (
            <IntegrationKeyMethod integrationID={integration.id} title={methodLabel(method)} />
          ))
        }

        const result = await sdk.client.v2.integration.connect.oauth({
          integrationID: integration.id,
          methodID: method.id,
          inputs: {},
        })
        if (result.error || !result.data) {
          toast.show({ variant: "error", message: JSON.stringify(result.error ?? "Authorization failed") })
          dialog.clear()
          return
        }
        const attempt = result.data.data
        dialog.replace(() => (
          <IntegrationOAuthMethod integrationID={integration.id} title={method.label} attempt={attempt} />
        ))
      },
    }))
}

export function DialogIntegration() {
  const options = createDialogIntegrationOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface OAuthProps {
  integrationID: string
  title: string
  attempt: IntegrationAttempt
}

function IntegrationOAuthMethod(props: OAuthProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const data = useData()
  const toast = useToast()
  const clipboard = useClipboard()
  const [failed, setFailed] = createSignal<string | undefined>()

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "Copy provider code",
        group: "Dialog",
        cmd: () => {
          const value = props.attempt.instructions.match(CODE_PATTERN)?.[0] ?? props.attempt.url
          clipboard
            .write?.(value)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  const finish = async () => {
    // The credential only becomes visible to the catalog once the integration
    // list is refetched, and the model dialog reads that list. The id is passed
    // on as a providerID to preselect that provider's models: the two are
    // separate namespaces, but every integration in the catalog today names its
    // provider after itself, and a miss only costs the preselection.
    await data.location.integration.refresh()
    dialog.replace(() => <DialogModel providerID={props.integrationID} />)
  }

  // mode "code": the user pastes something back. mode "auto": the server is
  // already polling the provider, and we poll the server for the outcome.
  onMount(() => {
    if (props.attempt.mode === "code") return
    let cancelled = false
    const deadline = Date.now() + POLL_TIMEOUT_MS
    const timer = setInterval(async () => {
      if (cancelled) return
      if (Date.now() > deadline) {
        cancelled = true
        clearInterval(timer)
        setFailed("Timed out waiting for authorization")
        return
      }
      const result = await sdk.client.v2.integration.attempt.status({ attemptID: props.attempt.attemptID })
      if (cancelled || result.error) return
      const status = result.data?.data
      if (!status || status.status === "pending") return
      cancelled = true
      clearInterval(timer)
      if (status.status === "complete") return finish()
      setFailed(status.status === "failed" ? status.message : "Authorization expired — try /connect again")
    }, POLL_INTERVAL_MS)
    onCleanup(() => {
      cancelled = true
      clearInterval(timer)
      // Leaving an attempt pending server-side holds its slot until it expires.
      if (!failed()) void sdk.client.v2.integration.attempt.cancel({ attemptID: props.attempt.attemptID })
    })
  })

  return (
    <Show
      when={props.attempt.mode === "auto"}
      fallback={
        <DialogPrompt
          title={props.title}
          placeholder="Authorization code"
          onConfirm={async (value) => {
            const { error } = await sdk.client.v2.integration.attempt.complete({
              attemptID: props.attempt.attemptID,
              code: value,
            })
            if (!error) return finish()
            setFailed("Invalid code")
          }}
          description={() => (
            <box gap={1}>
              <text fg={theme.textMuted}>{props.attempt.instructions}</text>
              <Link href={props.attempt.url} fg={theme.primary} />
              <Show when={failed()}>
                <text fg={theme.error}>{failed()}</text>
              </Show>
            </box>
          )}
        />
      }
    >
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box gap={1}>
          <Link href={props.attempt.url} fg={theme.primary} />
          <text fg={theme.textMuted}>{props.attempt.instructions}</text>
        </box>
        <Show when={failed()} fallback={<text fg={theme.textMuted}>Waiting for authorization...</text>}>
          <text fg={theme.error}>{failed()}</text>
        </Show>
        <text fg={theme.text}>
          c <span style={{ fg: theme.textMuted }}>copy</span>
        </text>
      </box>
    </Show>
  )
}

interface KeyProps {
  integrationID: string
  title: string
}

function IntegrationKeyMethod(props: KeyProps) {
  const sdk = useSDK()
  const dialog = useDialog()
  const data = useData()
  const toast = useToast()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      onConfirm={async (value) => {
        if (!value) return
        const { error } = await sdk.client.v2.integration.connect.key({
          integrationID: props.integrationID,
          key: value,
        })
        if (error) {
          toast.show({ variant: "error", message: JSON.stringify(error) })
          dialog.clear()
          return
        }
        await data.location.integration.refresh()
        dialog.replace(() => <DialogModel providerID={props.integrationID} />)
      }}
    />
  )
}
