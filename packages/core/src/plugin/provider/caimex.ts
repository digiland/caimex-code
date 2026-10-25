import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Money } from "@opencode/schema/money"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
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

// Set by the CLI build (cli/script/build.ts); source runs report "local".
declare const OPENCODE_VERSION: string | undefined

// The gateway treats a caller as Caimex Code when its User-Agent contains
// `caimex-code/` (app/gateway/model_access.py, `_is_cli_user_agent`); the slash
// matters. It then lists only the models an admin enabled for the CLI ("CLI access"
// in the portal), chat and code kinds only. A bare `caimex-code` matched nothing, so
// the picker got the whole catalog: voices, embeddings and rerankers included.
const USER_AGENT = `caimex-code/${typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"}`

// What a signed-out (or revoked) user sees instead of the gateway's "Invalid
// authorization header" when a request is refused. The same service answers the CLI and
// the desktop app, and desktop users may not have the command, so both ways are named.
const LOGIN_COMMAND = "caimex auth login"
const DESKTOP_SIGN_IN = "Settings → Providers"
const signInMessage = (connected: boolean) =>
  connected
    ? `Your Caimex sign-in has expired or was revoked. Run \`${LOGIN_COMMAND}\` to sign in again (in the desktop app: ${DESKTOP_SIGN_IN}), then retry.`
    : `You're not signed in to Caimex. Run \`${LOGIN_COMMAND}\` to sign in (in the desktop app: ${DESKTOP_SIGN_IN}), then retry.`

// What a too-large request (HTTP 413) says instead of a proxy's HTML page. Every request re-sends
// the whole conversation, so it fails every turn until the conversation shrinks.
const TOO_LARGE_MESSAGE =
  "This conversation is too large to send to Caimex. Run /compact (in the desktop app: Compact) to summarise it, or start a new session."

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
  // The gateway's own signal: "tools" is listed for models that take tool calls.
  capability_tags: nullish(Schema.Array(Schema.String)),
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
    // Seeded from the catalog another location in this process already fetched: each
    // project folder loads its own copy of this plugin, and a folder that started with an
    // empty list refused its first prompt ("Model unavailable") until its own fetch landed.
    let models: readonly (typeof CatalogModel.Type)[] = sharedCatalog ?? []

    // Slow (the gateway probes its providers) and the one call that can fail while all
    // else works; a failure keeps the previous list rather than emptying the provider.
    // Fetched before sign-in too, so the picker offers the CLI models and a request then
    // explains how to sign in (see the http.response hook below). With a connection the
    // key goes along, and the gateway narrows the list to what that key and its workspace
    // may call. OPENCODE_DISABLE_MODELS_FETCH (set by the test environments) skips it.
    const load = Effect.fn("CaimexPlugin.load")(function* () {
      if (truthy(process.env["OPENCODE_DISABLE_MODELS_FETCH"])) return
      const connection = yield* ctx.integration.connection.active(INTEGRATION_ID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const key = credential?.type === "key" ? credential.key : credential?.type === "oauth" ? credential.access : undefined
      const fetched = yield* fetchModels(http, key).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to load Caimex model catalog", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (fetched === undefined) return
      models = fetched
      sharedCatalog = fetched
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
          const tools = supportsTools(model)
          draft.capabilities = {
            tools,
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
          // Every agent request carries tools, and the gateway refuses a model without
          // them ("None of the requested or fallback models support tool calls"), so such a
          // model could only ever fail here: it stays out of the picker.
          draft.enabled = tools
          draft.status = "active"
        })
      }
    })

    // Every model request is sent with the app's generic User-Agent
    // (`opencode/<channel>/<version>/<client>`, session/model-request.ts), which since v2.0.26
    // wins over `provider.headers`. The gateway tells Caimex Code apart by `caimex-code/` and
    // applies the CLI's model access and limits to it; without it a request was treated as
    // another surface and refused ("Budget limit reached (too many concurrent requests)",
    // "The request was rejected as invalid"). Set it last, as the Azure plugin does.
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.sync(() => {
          event.request.headers.set("user-agent", USER_AGENT)
        }),
      { providerID: Provider.ID.make(PROVIDER_ID) },
    )

    // A refused request (401: no key, or one the gateway no longer accepts) reads as
    // "Invalid authorization header"; say how to sign in instead. A request too large for
    // the gateway's front door (413) arrives as an nginx HTML page; say how to shrink it.
    yield* ctx.session.hook(
      "http.response",
      (event) =>
        Effect.gen(function* () {
          if (event.response.status === 413) {
            event.response = Response.json(
              { error: { message: TOO_LARGE_MESSAGE, type: "invalid_request_error", code: "request_too_large" } },
              { status: 413, statusText: event.response.statusText },
            )
            return
          }
          if (event.response.status !== 401) return
          const connected = (yield* ctx.integration.connection.active(INTEGRATION_ID)) !== undefined
          event.response = Response.json(
            { error: { message: signInMessage(connected), type: "authentication_error", code: "authentication_error" } },
            { status: 401, statusText: event.response.statusText },
          )
        }),
      { providerID: Provider.ID.make(PROVIDER_ID) },
    )

    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === INTEGRATION_ID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    // The first location in a process waits for the catalog (at most 10s, so a gateway
    // that's down only delays it); later ones start from the shared copy and refresh in
    // the background.
    if (sharedCatalog === undefined)
      yield* loading.withPermit(load()).pipe(Effect.timeout("10 seconds"), Effect.ignore)
    else yield* refresh().pipe(Effect.forkScoped)
    yield* refresh().pipe(Effect.delay("15 minutes"), Effect.repeat(Schedule.spaced("15 minutes")), Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)

// Shared by every location's copy of the plugin in this process (see `models` above).
let sharedCatalog: readonly (typeof CatalogModel.Type)[] | undefined

function interval(seconds: number | undefined) {
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? Duration.seconds(seconds) : DEFAULT_INTERVAL
}

// Explicit flags win; otherwise the gateway's capability tags decide, and a model that
// sends no tags at all is assumed capable (older gateways sent none).
function supportsTools(model: typeof CatalogModel.Type) {
  return model.tool_call ?? model.supports_tools ?? (model.capability_tags ? model.capability_tags.includes("tools") : true)
}

const truthy = (value: string | undefined) => value === "1" || value?.toLowerCase() === "true"

// With a key the gateway narrows the list to that key and its workspace; a key it
// refuses (revoked, expired) falls back to the signed-out list rather than none.
function fetchModels(http: HttpClient.HttpClient, key?: string) {
  const request = (key?: string) =>
    HttpClient.filterStatusOk(http)
      .execute(
        HttpClientRequest.get(`${apiBase()}/models`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeaders({
            "User-Agent": USER_AGENT,
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(CatalogResponse)),
        Effect.map((body) => body.data ?? []),
        Effect.timeout("60 seconds"),
      )
  return key ? request(key).pipe(Effect.catch(() => request())) : request()
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
