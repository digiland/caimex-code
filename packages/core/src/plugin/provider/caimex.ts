import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Money } from "@opencode/schema/money"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import type { PluginInternal } from "../internal.js"

// Caimex Desktop: every model comes from the Caimex gateway, an OpenAI-compatible
// endpoint, with sign-in by device code. Ported from the CLI fork
// (digiland/caimex-code, packages/core/src/plugin/provider/caimex.ts); the gateway
// behaviour it encodes (URLs, the login origin fix, the User-Agent the model list is
// filtered on, the key names the token comes back under) must stay the same in both.
const DEFAULT_GATEWAY_URL = "https://caimex.econetai.co.zw:2052"
const DEFAULT_API_BASE_URL = "https://caimex.econetai.co.zw:2052/v1"
const CLIENT_ID = "caimex-code"
const SCOPE = "gateway"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

export const PROVIDER_ID = "caimex"
const INTEGRATION_ID = Integration.ID.make("caimex")
const METHOD_ID = Integration.MethodID.make("device")

// The sign-in page serves on the canonical origin (443) while the gateway still
// advertises the retired :2082 in `verification_uri`; the browser URL is pinned to this
// origin, keeping the gateway's path and query. CAIMEX_LOGIN_URL overrides it.
const DEFAULT_LOGIN_URL = "https://caimex.econetai.co.zw"
const DEFAULT_LOGIN_HOSTNAME = "caimex.econetai.co.zw"

const stripSlash = (value: string) => value.replace(/\/+$/, "")
const gatewayBase = () => stripSlash(process.env["CAIMEX_GATEWAY_URL"] ?? DEFAULT_GATEWAY_URL)
export const apiBase = () => stripSlash(process.env["CAIMEX_API_BASE_URL"] ?? DEFAULT_API_BASE_URL)
const deviceCodeUrl = () => process.env["CAIMEX_DEVICE_CODE_URL"] ?? `${gatewayBase()}/api/auth/device/code`
const deviceTokenUrl = () => process.env["CAIMEX_DEVICE_TOKEN_URL"] ?? `${gatewayBase()}/api/auth/device/token`

const normalizeLoginUrl = (uri: string) => {
  const override = process.env["CAIMEX_LOGIN_URL"]
  try {
    const url = new URL(uri)
    if (!override && url.hostname !== DEFAULT_LOGIN_HOSTNAME) return uri
    const base = new URL(stripSlash(override ?? DEFAULT_LOGIN_URL))
    url.protocol = base.protocol
    url.hostname = base.hostname
    url.port = base.port
    return url.toString()
  } catch {
    return uri
  }
}

// The gateway filters /v1/models by User-Agent: it serves the set an admin enabled for
// the Caimex Code surface, and `caimex-code` is the token it matches on.
const USER_AGENT = "caimex-code"

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.String.pipe(Schema.optional),
  expires_in: Schema.Number.pipe(Schema.optional),
  interval: Schema.Number.pipe(Schema.optional),
})

// One flat struct branched on `error`: a union of {all optional} | {error} can't
// discriminate once excess properties are stripped, which once read every pending poll
// as a success with no key.
export const DeviceTokenSchema = Schema.Struct({
  error: Schema.String.pipe(Schema.optional),
  error_description: Schema.String.pipe(Schema.optional),
  api_key: Schema.String.pipe(Schema.optional),
  access_token: Schema.String.pipe(Schema.optional),
  key: Schema.String.pipe(Schema.optional),
})

// Numbers may arrive as JSON strings, and "no value" as an explicit null.
const Numeric = Schema.Union([Schema.Number, Schema.String])
const nullish = <S extends Schema.Top>(schema: S) => Schema.Union([schema, Schema.Null]).pipe(Schema.optional)
const numeric = (value: number | string | null | undefined) => {
  if (value === undefined || value === null) return undefined
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const firstPositive = (...values: (number | string | null | undefined)[]) => {
  for (const value of values) {
    const parsed = numeric(value)
    if (parsed !== undefined && parsed > 0) return parsed
  }
  return undefined
}

const DEFAULT_CONTEXT = Number(process.env["CAIMEX_DISCOVERY_DEFAULT_CONTEXT"]) || 128_000
const DEFAULT_OUTPUT = Number(process.env["CAIMEX_DISCOVERY_DEFAULT_OUTPUT"]) || 32_000

const KNOWN_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const
const modalities = (value: readonly string[] | null | undefined, fallback: string) => {
  const known = (value ?? []).filter((item) => (KNOWN_MODALITIES as readonly string[]).includes(item))
  return known.length ? Array.from(new Set(known)) : [fallback]
}

const Modalities = nullish(Schema.Array(Schema.String))
const CatalogModel = Schema.Struct({
  id: Schema.String,
  pricing: nullish(Schema.Struct({ input_per_1m: nullish(Numeric), output_per_1m: nullish(Numeric) })),
  context_length: nullish(Numeric),
  context_window: nullish(Numeric),
  max_context_length: nullish(Numeric),
  max_context_tokens: nullish(Numeric),
  max_output_tokens: nullish(Numeric),
  max_tokens: nullish(Numeric),
  limit: nullish(Schema.Struct({ context: nullish(Numeric), output: nullish(Numeric) })),
  input_modalities: Modalities,
  output_modalities: Modalities,
  modalities: Modalities,
  tool_call: nullish(Schema.Boolean),
  supports_tools: nullish(Schema.Boolean),
})
const CatalogResponse = Schema.Struct({ data: nullish(Schema.Array(CatalogModel)) })

const DEFAULT_INTERVAL = Duration.seconds(5)
const SLOW_DOWN_INCREMENT = Duration.seconds(5)

function oauth(http: HttpClient.HttpClient) {
  return {
    integrationID: INTEGRATION_ID,
    method: { id: METHOD_ID, type: "oauth", label: "Log in with Caimex" },
    authorize: () =>
      Effect.gen(function* () {
        const device = yield* post(http, deviceCodeUrl(), { client_id: CLIENT_ID, scope: SCOPE }, Device)
        return {
          mode: "auto" as const,
          url: normalizeLoginUrl(device.verification_uri_complete ?? device.verification_uri),
          instructions: `Open ${normalizeLoginUrl(device.verification_uri)} on any device and enter code: ${device.user_code}`,
          callback: poll(http, device.device_code, interval(device.interval)),
        }
      }),
    // No `refresh`: the gateway issues a long-lived key, not a refreshable token pair.
  } satisfies IntegrationOAuthMethodRegistration
}

export const CaimexPlugin = define<HttpClient.HttpClient | Bus.Service | Scope.Scope>({
  id: "caimex.provider.caimex",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const http = yield* HttpClient.HttpClient
    const loading = Semaphore.makeUnsafe(1)
    let models: readonly (typeof CatalogModel.Type)[] = []

    // Slow (the gateway probes its providers) and the one call that can fail while all
    // else works; a failure keeps the previous list rather than emptying the provider.
    const load = Effect.fn("CaimexPlugin.load")(function* () {
      const fetched = yield* fetchModels(http).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to load Caimex model catalog", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (fetched !== undefined) models = fetched
    })

    yield* ctx.integration.transform((draft) => {
      draft.update(INTEGRATION_ID, (integration) => {
        integration.name = "Caimex"
      })
      draft.method.update(oauth(http))
      draft.method.update({ integrationID: INTEGRATION_ID, method: { type: "key", label: "Paste a Caimex API key" } })
      draft.method.update({ integrationID: INTEGRATION_ID, method: { type: "env", names: ["CAIMEX_API_KEY"] } })
    })

    yield* ctx.provider.transform((providers) => {
      providers.update(PROVIDER_ID, (provider) => {
        provider.name = "Caimex Gateway"
        provider.integrationID = INTEGRATION_ID
        provider.package = "@opencode/ai/providers/openai-compatible"
        provider.settings = { ...provider.settings, baseURL: apiBase(), provider: PROVIDER_ID }
        provider.headers = { ...provider.headers, "User-Agent": USER_AGENT }
        // Listed before sign-in: the connect dialog lists providers, so a provider hidden
        // until it has a connection could never be signed into.
        provider.activation = "enabled"
      })
      for (const model of models) {
        providers.models.update(PROVIDER_ID, model.id, (draft) => {
          draft.modelID = Model.ID.make(model.id)
          draft.name = model.id
          // Prices arrive as dollars per 1M tokens; no pricing means free to the caller.
          draft.cost = [
            {
              input: Money.USDPerMillionTokens.make(numeric(model.pricing?.input_per_1m) ?? 0),
              output: Money.USDPerMillionTokens.make(numeric(model.pricing?.output_per_1m) ?? 0),
              cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
            },
          ]
          draft.capabilities = {
            tools: model.tool_call ?? model.supports_tools ?? true,
            input: modalities(model.input_modalities ?? model.modalities, "text"),
            output: modalities(model.output_modalities, "text"),
          }
          draft.limit = {
            ...draft.limit,
            context: Math.floor(
              firstPositive(
                model.context_length,
                model.context_window,
                model.max_context_length,
                model.max_context_tokens,
                model.limit?.context,
              ) ?? DEFAULT_CONTEXT,
            ),
            output: Math.floor(
              firstPositive(model.max_output_tokens, model.max_tokens, model.limit?.output) ?? DEFAULT_OUTPUT,
            ),
          }
          draft.enabled = true
          draft.status = "active"
        })
      }
    })

    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === INTEGRATION_ID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.repeat(Schedule.spaced("15 minutes")), Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)

function interval(seconds: number | undefined) {
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? Duration.seconds(seconds) : DEFAULT_INTERVAL
}

function fetchModels(http: HttpClient.HttpClient) {
  return HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.get(`${apiBase()}/models`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders({ "User-Agent": USER_AGENT }),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(CatalogResponse)),
      Effect.map((body) => body.data ?? []),
      Effect.timeout("60 seconds"),
    )
}

function poll(http: HttpClient.HttpClient, deviceCode: string, wait: Duration.Duration): Effect.Effect<Credential.OAuth, unknown> {
  const loop = (wait: Duration.Duration): Effect.Effect<Credential.OAuth, unknown> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const result = yield* post(
        http,
        deviceTokenUrl(),
        { grant_type: DEVICE_CODE_GRANT_TYPE, client_id: CLIENT_ID, device_code: deviceCode },
        DeviceTokenSchema,
        false,
      )
      if (result.error !== undefined) {
        if (result.error === "authorization_pending") return yield* loop(wait)
        if (result.error === "slow_down") return yield* loop(Duration.sum(wait, SLOW_DOWN_INCREMENT))
        if (result.error === "access_denied" || result.error === "authorization_denied")
          return yield* Effect.fail(new Error("Caimex sign-in was denied"))
        if (result.error === "expired_token") return yield* Effect.fail(new Error("The Caimex sign-in code expired; try again"))
        return yield* Effect.fail(new Error(`Caimex sign-in failed: ${result.error}`))
      }
      const key = result.api_key ?? result.access_token ?? result.key
      if (!key) return yield* Effect.fail(new Error("The Caimex sign-in response didn't include an API key"))
      return Credential.OAuth.make({
        type: "oauth" as const,
        methodID: METHOD_ID,
        access: key,
        refresh: "",
        expires: 0,
        metadata: { gateway: gatewayBase() },
      })
    })
  return loop(wait)
}

function post<S extends Schema.Top>(
  http: HttpClient.HttpClient,
  url: string,
  body: Record<string, string>,
  schema: S,
  statusOk = true,
) {
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.setHeaders({ "User-Agent": USER_AGENT }),
    HttpClientRequest.schemaBodyJson(Schema.Record(Schema.String, Schema.String))(body),
    Effect.flatMap((request) => http.execute(request)),
    Effect.flatMap((response) => (statusOk ? HttpClientResponse.filterStatusOk(response) : Effect.succeed(response))),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  )
}
