import { Duration, Effect, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { EventV2 } from "../../event"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ProviderV2 } from "../../provider"

// The v2 port of packages/opencode/src/plugin/caimex.ts. Same gateway, same
// device-auth endpoints, same discovery-from-/v1/models behaviour — expressed
// against v2's integration/catalog plugin API instead of v1's config hook.
//
// The two ports must keep agreeing about the gateway, so the env overrides are
// deliberately spelled the same as v1's.
const DEFAULT_GATEWAY_URL = "https://caimex.econetai.co.zw:2052"
const DEFAULT_API_BASE_URL = "https://caimex.econetai.co.zw:2052/v1"
const CLIENT_ID = "caimex-code"
const SCOPE = "gateway"
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

const PROVIDER_ID = ProviderV2.ID.make("caimex")
const INTEGRATION_ID = Integration.ID.make("caimex")
const METHOD_ID = Integration.MethodID.make("device")

// The sign-in UI serves on the canonical origin (443), but the gateway still
// advertises the retired :2082 in `verification_uri`, so the browser URL is
// pinned to this origin — keeping the gateway's path and query. Kept in step
// with v1's normalizeLoginUrl; CAIMEX_LOGIN_URL overrides both.
const DEFAULT_LOGIN_URL = "https://caimex.econetai.co.zw"
const DEFAULT_LOGIN_HOSTNAME = "caimex.econetai.co.zw"

const stripSlash = (value: string) => value.replace(/\/+$/, "")
const gatewayBase = () => stripSlash(process.env["CAIMEX_GATEWAY_URL"] ?? DEFAULT_GATEWAY_URL)
const apiBase = () => stripSlash(process.env["CAIMEX_API_BASE_URL"] ?? DEFAULT_API_BASE_URL)
const deviceCodeUrl = () => process.env["CAIMEX_DEVICE_CODE_URL"] ?? `${gatewayBase()}/api/auth/device/code`
const deviceTokenUrl = () => process.env["CAIMEX_DEVICE_TOKEN_URL"] ?? `${gatewayBase()}/api/auth/device/token`

// Origin-only rewrite, keeping the gateway's path and query. Without an
// explicit override only the one stale origin is touched, so pointing the
// gateway at localhost for dev does not send login at production.
//
// `hostname` and `port` are assigned separately because setting `host` to a
// portless value leaves any existing port intact — the very port being dropped
// here. Unparseable input passes through unchanged.
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

// The gateway filters /v1/models by User-Agent — it serves the set an admin
// enabled for the Caimex Code surface — so an unidentified fetch would list
// models the request path then refuses. The `caimex-code` token is what it
// matches on, even though the command itself is named `caimex`.
const USER_AGENT = "caimex-code"

// Catalog.available() only surfaces an integration-backed provider once that
// integration has a connection. Before login the gateway would therefore be
// invisible in the desktop — and invisible means impossible to log into, since
// the connect dialog lists providers, not integrations. Upstream's own opencode
// plugin solves exactly this by parking a placeholder apiKey on the provider
// while it is unconnected; do the same, with an empty key rather than a
// made-up one so an unauthenticated request fails as unauthorized instead of as
// a bad token. It is removed the moment a real connection exists, and a key the
// user put in their own config is never touched.
const UNCONNECTED_API_KEY = ""

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.String.pipe(Schema.optional),
  expires_in: Schema.Number.pipe(Schema.optional),
  interval: Schema.Number.pipe(Schema.optional),
})

// Unlike OpenCode Console, the gateway mints a long-lived API key rather than an
// access/refresh pair — under any of three key names, depending on its version.
// The polling error shares this shape rather than sitting in a separate union
// member: a union of {all optional} | {error} cannot discriminate, because a
// struct decode strips excess properties, so `{"error":"authorization_pending"}`
// matched the success member as `{}` with the error silently dropped. The very
// first poll then read as "authorized, but no key in the response" and failed
// the login ~5s in, every time, before anyone could reach the browser. One flat
// struct branched on `error` has nothing to get wrong.
export const DeviceTokenSchema = Schema.Struct({
  error: Schema.String.pipe(Schema.optional),
  error_description: Schema.String.pipe(Schema.optional),
  api_key: Schema.String.pipe(Schema.optional),
  access_token: Schema.String.pipe(Schema.optional),
  key: Schema.String.pipe(Schema.optional),
})

// The gateway serves numbers as JSON strings ("0.5795000000") for pricing and,
// depending on the upstream provider it proxies, sometimes for the limits too.
// Accept either and normalise at the use site — a stricter schema fails the
// whole catalog over a quoted decimal.
const Numeric = Schema.Union([Schema.Number, Schema.String])
const numeric = (value: number | string | null | undefined) => {
  if (value === undefined || value === null) return undefined
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

// First strictly-positive value among the candidates. Mirrors v1's firstFinite.
const firstFinite = (...values: (number | string | null | undefined)[]) => {
  for (const value of values) {
    const parsed = numeric(value)
    if (parsed !== undefined && parsed > 0) return parsed
  }
  return undefined
}

// Fallbacks for a discovered model whose gateway entry advertises no window.
// `limit.context` of 0 is what ModelV2.Info.empty() leaves behind, and the
// picker reads it as a model that cannot hold a conversation. Same env names
// and same numbers as v1, because the two ports have to agree.
const DEFAULT_CONTEXT = Number(process.env["CAIMEX_DISCOVERY_DEFAULT_CONTEXT"]) || 128_000
const DEFAULT_OUTPUT = Number(process.env["CAIMEX_DISCOVERY_DEFAULT_OUTPUT"]) || 32_000

// The gateway spells "no value" as an explicit null — `"context_length": null`
// is on every entry it has not measured — and Schema.optional alone rejects
// that. One rejected field fails the whole response, which empties the provider
// rather than degrading it: the catalog decode has been failing outright
// against the live gateway, so v2 offered no Caimex models at all. Every
// optional field here accepts null and is normalised at the use site.
const nullish = <S extends Schema.Top>(schema: S) => Schema.Union([schema, Schema.Null]).pipe(Schema.optional)

const Pricing = Schema.Struct({
  input_per_1m: nullish(Numeric),
  output_per_1m: nullish(Numeric),
})

// Modalities the v2 catalog understands. Anything else the gateway advertises
// is dropped rather than passed through, so one unfamiliar value cannot make a
// model's capabilities unreadable to the picker.
const KNOWN_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const
type Modality = (typeof KNOWN_MODALITIES)[number]
const modalities = (value: readonly string[] | null | undefined, fallback: Modality) => {
  const known = (value ?? []).filter((item): item is Modality => KNOWN_MODALITIES.includes(item as Modality))
  return known.length ? Array.from(new Set(known)) : [fallback]
}

const Modalities = nullish(Schema.Array(Schema.String))
// Every alias here is one v1 already accepts. Gateways spell the context window
// a dozen ways and the two ports have to agree about which ones they read, so
// the lists are kept identical to firstFinite()'s arguments in
// packages/opencode/src/plugin/caimex.ts.
const CatalogModel = Schema.Struct({
  id: Schema.String,
  pricing: nullish(Pricing),
  context_length: nullish(Numeric),
  context_window: nullish(Numeric),
  max_context_length: nullish(Numeric),
  max_context_tokens: nullish(Numeric),
  max_output_tokens: nullish(Numeric),
  max_tokens: nullish(Numeric),
  limit: nullish(
    Schema.Struct({
      context: nullish(Numeric),
      output: nullish(Numeric),
    }),
  ),
  input_modalities: Modalities,
  output_modalities: Modalities,
  modalities: Modalities,
  // The gateway does not advertise tool support today. v1 has always assumed it
  // (`tool_call ?? true` in provider.ts) and an OpenAI-compatible chat endpoint
  // is expected to have it, so absence means yes — but an explicit false is
  // honoured if a future gateway version starts saying so.
  tool_call: nullish(Schema.Boolean),
  supports_tools: nullish(Schema.Boolean),
})
const CatalogResponse = Schema.Struct({
  data: nullish(Schema.Array(CatalogModel)),
})

const DEFAULT_INTERVAL = Duration.seconds(5)
const SLOW_DOWN_INCREMENT = Duration.seconds(5)

function oauth(http: HttpClient.HttpClient) {
  return {
    integrationID: INTEGRATION_ID,
    method: {
      id: METHOD_ID,
      type: "oauth",
      label: "Login with Caimex",
    },
    authorize: () =>
      Effect.gen(function* () {
        const device = yield* post(http, deviceCodeUrl(), { client_id: CLIENT_ID, scope: SCOPE }, Device)
        // The …_complete form embeds the user code, so an opened tab needs no
        // typing. The instructions still quote the bare URI and the code, which
        // is what someone authorizing from a phone actually needs.
        return {
          mode: "auto" as const,
          url: normalizeLoginUrl(device.verification_uri_complete ?? device.verification_uri),
          instructions: `Open ${normalizeLoginUrl(device.verification_uri)} on any device and enter code: ${device.user_code}`,
          callback: poll(http, device.device_code, interval(device.interval)),
        }
      }),
    // Deliberately no `refresh`: the gateway issues a long-lived key, not a
    // refreshable token pair. Integration.connection.resolve only consults
    // `expires` when a refresh implementation exists, so omitting it is what
    // keeps the stored credential from being treated as perpetually expired.
  } satisfies IntegrationOAuthMethodRegistration
}

export const CaimexPlugin = define<HttpClient.HttpClient | EventV2.Service | Scope.Scope>({
  id: "caimex",
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const http = yield* HttpClient.HttpClient
    const loading = Semaphore.makeUnsafe(1)
    let models: readonly (typeof CatalogModel.Type)[] = []
    let connected = false

    // The gateway probes providers to answer this, so it is slow and it is the
    // one call here that can fail while everything else still works. A failure
    // leaves the previous catalog in place rather than emptying the provider.
    const load = Effect.fn("CaimexPlugin.load")(function* () {
      const fetched = yield* fetchModels(http).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to load Caimex model catalog", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (fetched !== undefined) models = fetched
      connected = (yield* ctx.integration.connection.active(INTEGRATION_ID)) !== undefined
    })

    yield* ctx.integration.transform((draft) => {
      draft.update(INTEGRATION_ID, (integration) => {
        integration.name = "Caimex"
      })
      draft.method.update(oauth(http))
      draft.method.update({
        integrationID: INTEGRATION_ID,
        method: { type: "key", label: "Paste a Caimex API key" },
      })
      // Same fallback as v1's `{env:CAIMEX_API_KEY}` — lets a locally-exported
      // key authenticate without running the device-login flow.
      draft.method.update({
        integrationID: INTEGRATION_ID,
        method: { type: "env", names: ["CAIMEX_API_KEY"] },
      })
    })

    connected = (yield* ctx.integration.connection.active(INTEGRATION_ID)) !== undefined
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(PROVIDER_ID, (provider) => {
        provider.integrationID = INTEGRATION_ID
        provider.name = "Caimex Gateway"
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: apiBase(),
        }
        const parked = provider.request.body["apiKey"] === UNCONNECTED_API_KEY
        if (connected && parked) delete provider.request.body["apiKey"]
        if (!connected && provider.request.body["apiKey"] === undefined) {
          provider.request.body["apiKey"] = UNCONNECTED_API_KEY
        }
      })

      for (const model of models) {
        catalog.model.update(PROVIDER_ID, model.id, (draft) => {
          draft.name = model.id
          // Prices arrive as dollars per 1M tokens, which is the unit `cost`
          // already uses. Absent pricing means free-to-caller, not unknown.
          draft.cost = [
            {
              input: numeric(model.pricing?.input_per_1m) ?? 0,
              output: numeric(model.pricing?.output_per_1m) ?? 0,
              cache: { read: 0, write: 0 },
            },
          ]
          // Unset capabilities are not a neutral default here: the schema's
          // empty() leaves `tools: false` and no modalities, which reads as a
          // model that can neither call a tool nor accept text.
          draft.capabilities = {
            tools: model.tool_call ?? model.supports_tools ?? true,
            input: modalities(model.input_modalities ?? model.modalities, "text"),
            output: modalities(model.output_modalities, "text"),
          }
          const context =
            firstFinite(
              model.context_length,
              model.context_window,
              model.max_context_length,
              model.max_context_tokens,
              model.limit?.context,
            ) ?? DEFAULT_CONTEXT
          const output = firstFinite(model.max_output_tokens, model.max_tokens, model.limit?.output) ?? DEFAULT_OUTPUT
          // `limit` is integral in the schema, and gateways do serve decimals.
          draft.limit.context = Math.floor(context)
          draft.limit.output = Math.floor(output)
          draft.enabled = true
          draft.status = "active"
        })
      }
    })

    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === INTEGRATION_ID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
  }),
})

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
    )
}

function poll(
  http: HttpClient.HttpClient,
  deviceCode: string,
  wait: Duration.Duration,
): Effect.Effect<Credential.OAuth, unknown> {
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
        if (result.error === "access_denied" || result.error === "authorization_denied") {
          return yield* Effect.fail(new Error("Caimex device authorization was denied"))
        }
        if (result.error === "expired_token") {
          return yield* Effect.fail(new Error("Caimex device code expired — please log in again"))
        }
        return yield* Effect.fail(new Error(`Caimex device authorization failed: ${result.error}`))
      }
      const key = result.api_key ?? result.access_token ?? result.key
      if (!key) return yield* Effect.fail(new Error("Caimex token response did not include an API key"))
      // Stored as an oauth credential so the login flow owns it (a key
      // credential is the paste-your-own path). `access` is what the session
      // runner lowers into the provider's apiKey either way.
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
