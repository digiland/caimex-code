import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import os from "os"
import path from "path"

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

// ── Model auto-discovery + live pricing ─────────────────────────────────────
// The gateway's GET /v1/models is the single source of truth for which models
// exist. Each entry carries per-model pricing (`input_per_1m` / `output_per_1m`,
// in dollars per 1M tokens — the exact unit opencode's `model.cost` uses) and,
// where the gateway advertises them, context/output limits.
//
// From this we do two things in the `config` hook, both keyed by model id:
//   1. Pricing — refresh the `cost` of every configured caimex model so the
//      CLI's cost meter reflects real prices instead of $0.
//   2. Discovery — register any gateway model NOT declared in caimex.json as a
//      new model, so adding a model to the gateway makes it appear in the CLI
//      with no client edit. Models explicitly configured in caimex.json keep
//      their settings; discovery only ever ADDS, never overrides.
//
// That endpoint is slow (it probes providers), so we never block startup: we
// inject from a local cache instantly and refresh the cache in the background.
// First run after install has no discovered models / shows $0; every run after
// uses the cached catalog. Set CAIMEX_DISABLE_MODEL_DISCOVERY=1 to keep pricing
// but suppress auto-registration (pin the model list to caimex.json only).

type Modality = "text" | "audio" | "image" | "video" | "pdf"
const KNOWN_MODALITIES: readonly Modality[] = ["text", "audio", "image", "video", "pdf"]

interface DiscoveredModel {
  input: number
  output: number
  context?: number
  outputLimit?: number
  inputModalities?: Modality[]
  outputModalities?: Modality[]
}

// Keep only modalities opencode's config schema understands; drop the rest.
// Returns undefined when nothing usable is present so callers can fall back.
function normalizeModalities(value: unknown): Modality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is Modality => KNOWN_MODALITIES.includes(v as Modality))
  return out.length ? Array.from(new Set(out)) : undefined
}
interface CatalogCache {
  at: number
  models: Record<string, DiscoveredModel>
}

const CATALOG_CACHE_FILE = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "caimex-code",
  "model-catalog.json",
)
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000 // refresh at most every 6h

// Fallback limits for a discovered model when the gateway's /v1/models entry
// doesn't advertise its own context/output window. Override per deployment.
const DISCOVERY_DEFAULT_CONTEXT = Number(process.env.CAIMEX_DISCOVERY_DEFAULT_CONTEXT) || 128_000
const DISCOVERY_DEFAULT_OUTPUT = Number(process.env.CAIMEX_DISCOVERY_DEFAULT_OUTPUT) || 32_000

function discoveryEnabled(): boolean {
  const flag = process.env.CAIMEX_DISABLE_MODEL_DISCOVERY
  return flag !== "1" && flag !== "true"
}

// First strictly-positive finite number among the candidates, else undefined.
// Gateways spell the context window a dozen ways; try the common ones.
function firstFinite(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function readCatalogCache(): CatalogCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(CATALOG_CACHE_FILE, "utf8")) as CatalogCache
    if (parsed && typeof parsed.at === "number" && parsed.models) return parsed
  } catch {}
  return undefined
}

function writeCatalogCache(models: Record<string, DiscoveredModel>): void {
  try {
    mkdirSync(path.dirname(CATALOG_CACHE_FILE), { recursive: true })
    writeFileSync(CATALOG_CACHE_FILE, JSON.stringify({ at: Date.now(), models } satisfies CatalogCache))
  } catch {}
}

export async function fetchModelCatalog(baseURL: string): Promise<Record<string, DiscoveredModel>> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`Caimex /v1/models request failed (${res.status})`)
  const body = (await res.json()) as { data?: Array<Record<string, any>> }
  const out: Record<string, DiscoveredModel> = {}
  for (const m of body.data ?? []) {
    const id = m?.id
    if (!id || typeof id !== "string") continue
    const input = Number(m?.pricing?.input_per_1m)
    const output = Number(m?.pricing?.output_per_1m)
    out[id] = {
      input: Number.isFinite(input) ? input : 0,
      output: Number.isFinite(output) ? output : 0,
      context: firstFinite(
        m?.context_length,
        m?.context_window,
        m?.max_context_length,
        m?.max_context_tokens,
        m?.limit?.context,
      ),
      outputLimit: firstFinite(m?.max_output_tokens, m?.max_tokens, m?.limit?.output),
      inputModalities: normalizeModalities(m?.input_modalities ?? m?.modalities),
      outputModalities: normalizeModalities(m?.output_modalities),
    }
  }
  return out
}

// Config-level cost shape: opencode's normalizer reads flat cache_read /
// cache_write keys from config models (see provider.ts), so we write those.
function costFrom(info: DiscoveredModel) {
  return { input: info.input, output: info.output, cache_read: 0, cache_write: 0 }
}

// Merge the gateway catalog into the configured models map, in place:
//   - configured model  → refresh live pricing only, leave the rest untouched
//   - unknown model      → register it (discovery), unless discovery is disabled
function applyCatalog(models: Record<string, any>, catalog: Record<string, DiscoveredModel>, discovery: boolean): void {
  for (const [id, info] of Object.entries(catalog)) {
    const existing = models[id]
    if (existing && typeof existing === "object") {
      existing.cost = costFrom(info)
      continue
    }
    if (!discovery) continue
    const context = info.context ?? DISCOVERY_DEFAULT_CONTEXT
    const input = info.inputModalities?.length ? info.inputModalities : (["text"] as Modality[])
    const output = info.outputModalities?.length ? info.outputModalities : (["text"] as Modality[])
    models[id] = {
      name: id,
      limit: { context, input: context, output: info.outputLimit ?? DISCOVERY_DEFAULT_OUTPUT },
      cost: costFrom(info),
      modalities: { input, output },
      // Non-text input implies the model accepts attachments (images/pdf/etc.).
      attachment: input.some((m) => m !== "text"),
    }
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
    // Register gateway models (discovery) and inject live pricing into the
    // caimex models' `cost`, both from GET /v1/models. Reads from cache
    // instantly; refreshes in the background (the endpoint is slow, so we never
    // block startup on it).
    async config(input) {
      try {
        const provider = (input as any)?.provider?.[PROVIDER_ID]
        if (!provider || typeof provider !== "object") return
        // Ensure a models map exists so discovery can populate a provider that
        // declares none in caimex.json.
        let models = provider.models
        if (!models || typeof models !== "object") models = provider.models = {}

        const cache = readCatalogCache()
        if (cache?.models) applyCatalog(models, cache.models, discoveryEnabled())

        const baseURL: string = provider?.options?.baseURL ?? `${gatewayBase()}/v1`
        const stale = !cache || Date.now() - cache.at > CATALOG_TTL_MS
        if (stale) {
          // Fire-and-forget: populates the cache for the next start.
          fetchModelCatalog(baseURL)
            .then((catalog) => {
              if (Object.keys(catalog).length) writeCatalogCache(catalog)
            })
            .catch(() => {})
        }
      } catch {}
    },
  }
}
