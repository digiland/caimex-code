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

const stripSlash = (value: string) => value.replace(/\/+$/, "")
const gatewayBase = () => stripSlash(process.env["CAIMEX_GATEWAY_URL"] ?? DEFAULT_GATEWAY_URL)
const apiBase = () => stripSlash(process.env["CAIMEX_API_BASE_URL"] ?? DEFAULT_API_BASE_URL)
const deviceCodeUrl = () => process.env["CAIMEX_DEVICE_CODE_URL"] ?? `${gatewayBase()}/api/auth/device/code`
const deviceTokenUrl = () => process.env["CAIMEX_DEVICE_TOKEN_URL"] ?? `${gatewayBase()}/api/auth/device/token`

// The gateway filters /v1/models by User-Agent — it serves the set an admin
// enabled for the Caimex Code surface — so an unidentified fetch would list
// models the request path then refuses. The `caimex-code` token is what it
// matches on, even though the command itself is named `caimex`.
const USER_AGENT = "caimex-code"

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
const TokenSuccess = Schema.Struct({
  api_key: Schema.String.pipe(Schema.optional),
  access_token: Schema.String.pipe(Schema.optional),
  key: Schema.String.pipe(Schema.optional),
})
const TokenPending = Schema.Struct({
  error: Schema.String,
  error_description: Schema.String.pipe(Schema.optional),
})
const DeviceToken = Schema.Union([TokenSuccess, TokenPending])

// The gateway serves numbers as JSON strings ("0.5795000000") for pricing and,
// depending on the upstream provider it proxies, sometimes for the limits too.
// Accept either and normalise at the use site — a stricter schema fails the
// whole catalog over a quoted decimal.
const Numeric = Schema.Union([Schema.Number, Schema.String])
const numeric = (value: number | string | undefined) => {
  if (value === undefined) return undefined
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const Pricing = Schema.Struct({
  input_per_1m: Numeric.pipe(Schema.optional),
  output_per_1m: Numeric.pipe(Schema.optional),
})
const CatalogModel = Schema.Struct({
  id: Schema.String,
  pricing: Pricing.pipe(Schema.optional),
  context_length: Numeric.pipe(Schema.optional),
  max_output_tokens: Numeric.pipe(Schema.optional),
})
const CatalogResponse = Schema.Struct({
  data: CatalogModel.pipe(Schema.Array, Schema.optional),
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
          url: device.verification_uri_complete ?? device.verification_uri,
          instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
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
    })

    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(PROVIDER_ID, (provider) => {
        provider.integrationID = INTEGRATION_ID
        provider.name = "Caimex Gateway"
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: apiBase(),
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
          const context = numeric(model.context_length)
          const output = numeric(model.max_output_tokens)
          if (context !== undefined) draft.limit.context = context
          if (output !== undefined) draft.limit.output = output
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
        DeviceToken,
        false,
      )
      if ("error" in result) {
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
