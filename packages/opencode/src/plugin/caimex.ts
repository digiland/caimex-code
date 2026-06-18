import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// Auth plugin for the Caimex gateway. Registers two ways to log in to the
// `caimex` provider:
//
//   1. "Login with Caimex"  — RFC 8628 device-authorization grant. The CLI
//      prints a short user code + a URL; the user opens the URL in any browser,
//      signs in to Caimex, enters the code, and the CLI long-polls the token
//      endpoint until the gateway issues an API key. No loopback server, so it
//      works over SSH / Docker / headless.
//   2. "Paste an API key"   — the user pastes a gateway key (sk-or-...).
//
// Both paths end with a gateway API key stored in auth.json; the `loader`
// injects it as the OpenAI-compatible provider's `options.apiKey`. This
// replaces the old `{env:CAIMEX_API_KEY}` approach (the env var still works as
// a fallback if set, since config options deep-merge over the loader).
//
// The gateway must implement the two endpoints described in
// deploy/GATEWAY-AUTH-CONTRACT.md. Their location is derived from the gateway
// base URL; override per deployment with the env vars below.

const PROVIDER_ID = "caimex"

// Where the device-auth endpoints live. Default to the local gateway; override
// to point at a deployed gateway. CAIMEX_DEVICE_*_URL win over CAIMEX_GATEWAY_URL.
const DEFAULT_GATEWAY_URL = "http://localhost:8240"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
const CLIENT_ID = "caimex-code"
const SCOPE = "gateway"

// Poll-loop bounds (RFC 8628 §3.5). The gateway returns `interval` (seconds);
// we floor it to avoid hammering and honor `slow_down` by backing off.
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

function gatewayBase(): string {
  return (process.env.CAIMEX_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, "")
}

function deviceCodeUrl(): string {
  return process.env.CAIMEX_DEVICE_CODE_URL ?? `${gatewayBase()}/api/auth/device/code`
}

function deviceTokenUrl(): string {
  return process.env.CAIMEX_DEVICE_TOKEN_URL ?? `${gatewayBase()}/api/auth/device/token`
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": `caimex/${InstallationVersion}`,
  }
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

interface DeviceTokenSuccess {
  // The gateway may name the issued key any of these; we accept all three.
  api_key?: string
  access_token?: string
  key?: string
  token_type?: string
}

interface DeviceTokenError {
  error?: string
  error_description?: string
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(deviceCodeUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Caimex device code request failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  const json = (await response.json()) as DeviceCodeResponse
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("Caimex device code response is missing device_code / user_code / verification_uri")
  }
  return json
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// Normalize a server-supplied seconds value to milliseconds, falling back to
// `defaultMs` when the input is missing, non-positive, or not finite. Guards the
// poll loop against garbage (`NaN`, `-5`, `"NaN"`) that would otherwise reach
// setTimeout as 0 and busy-loop until the deadline.
function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

/** Poll the token endpoint until the user authorizes, the code expires, or the deadline passes. */
export async function pollDeviceToken(
  device: DeviceCodeResponse,
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<string> {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())
  const deadline = now() + positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS)
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  )

  while (now() < deadline) {
    const response = await fetch(deviceTokenUrl(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }),
    })

    if (response.ok) {
      const body = (await response.json()) as DeviceTokenSuccess
      const key = body.api_key ?? body.access_token ?? body.key
      if (!key) throw new Error("Caimex token response did not include an API key")
      return key
    }

    const body = (await response.json().catch(() => ({}))) as DeviceTokenError
    const remaining = Math.max(0, deadline - now())
    if (body.error === "authorization_pending") {
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("Caimex device authorization was denied")
    }
    if (body.error === "expired_token") {
      throw new Error("Caimex device code expired - please re-run login")
    }
    const detail = body.error_description ?? body.error ?? ""
    throw new Error(`Caimex device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  throw new Error("Caimex device authorization timed out")
}

export async function CaimexAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: PROVIDER_ID,
      // Supply the stored gateway key as the OpenAI-compatible provider's
      // apiKey. baseURL still comes from caimex.json (config deep-merges over
      // this). Returns {} when not logged in, leaving the provider unauthed so
      // the CLI prompts for login.
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type === "api") return { apiKey: auth.key }
        if (auth.type === "oauth") return { apiKey: auth.access }
        return {}
      },
      methods: [
        {
          type: "oauth",
          label: "Login with Caimex (opens browser)",
          authorize: async () => {
            const device = await requestDeviceCode()
            const browserUrl = device.verification_uri_complete ?? device.verification_uri
            return {
              url: browserUrl,
              instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
              method: "auto" as const,
              callback: async () => {
                try {
                  const key = await pollDeviceToken(device)
                  return { type: "success" as const, key }
                } catch {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Paste a Caimex API key",
        },
      ],
    },
  }
}
