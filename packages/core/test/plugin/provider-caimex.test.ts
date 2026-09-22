import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import type { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CaimexPlugin, DeviceTokenSchema } from "@opencode-ai/core/plugin/provider/caimex"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { pluginTestLayer } from "./fixture"

// Shaped after a real GET /v1/models response from the gateway. The nulls are
// the point: the gateway sends `"context_length": null` on every model it has
// not measured, and a schema that only tolerates absence rejects the whole
// response — which emptied the provider silently rather than degrading it.
const CATALOG = {
  data: [
    {
      id: "Caimex/glm-5.2",
      object: "model",
      owned_by: "Caimex",
      pricing: { input_per_1m: "0.966", output_per_1m: "3.036" },
      modalities: ["text"],
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      context_length: null,
      max_output_tokens: null,
      description: null,
      per_request_limits: null,
    },
    {
      id: "measured/model",
      pricing: { input_per_1m: 1.5, output_per_1m: 2 },
      context_length: 200_000,
      max_output_tokens: 64_000,
      input_modalities: ["text", "chemistry"],
      output_modalities: ["audio"],
      tool_call: false,
    },
    {
      id: "aliased/model",
      context_window: "32768.5",
      max_tokens: "4096",
    },
  ],
}

const PROVIDER = ProviderV2.ID.make("caimex")

const client = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(CATALOG), { headers: { "content-type": "application/json" } }),
    ),
  ),
)

const it = testEffect(pluginTestLayer([[LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, client)]]))

// The device-token payload, decoded the way the plugin decodes it. Pinned
// separately from the plugin because the failure it guards was invisible: a
// pending poll that decodes as a *success* with no key reads exactly like an
// authorized-but-empty response, and the login died on its first poll rather
// than waiting for the browser.
const decodeToken = (input: unknown) => Effect.runSync(Schema.decodeUnknownEffect(DeviceTokenSchema)(input))

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* CaimexPlugin.effect(host)
})

// The plugin loads its catalog on a forked fiber, so the models land some time
// after the plugin itself is installed. Poll rather than sleep a fixed amount.
const models = (catalog: Catalog.Interface): Effect.Effect<ModelV2.Info[]> => {
  const attempt = (left: number): Effect.Effect<ModelV2.Info[]> =>
    Effect.gen(function* () {
      const all = (yield* catalog.model.all()).filter((model) => model.providerID === PROVIDER)
      if (all.length > 0 || left === 0) return all
      yield* Effect.sleep("10 millis")
      return yield* attempt(left - 1)
    })
  return attempt(200)
}

describe("CaimexPlugin", () => {
  it.effect("is registered", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("caimex"))),
  )

  it.live("registers the gateway as an openai-compatible provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      const provider = yield* catalog.provider.get(PROVIDER)
      expect(provider?.name).toBe("Caimex Gateway")
      expect(provider?.api).toMatchObject({ type: "aisdk", package: "@ai-sdk/openai-compatible" })
    }),
  )

  it.live("keeps every model when the gateway sends null for the fields it has not measured", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      expect((yield* models(catalog)).map((model) => String(model.id))).toEqual([
        "Caimex/glm-5.2",
        "measured/model",
        "aliased/model",
      ])
    }),
  )

  it.live("gives a model tools and modalities rather than the empty defaults", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      const [glm, measured] = yield* models(catalog)
      // Tool support is not advertised by the gateway; absence means yes, the
      // same assumption v1 makes. An explicit false is still honoured.
      expect(glm!.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
      // "chemistry" is not a modality the catalog knows — dropped, not passed on.
      expect(measured!.capabilities).toEqual({ tools: false, input: ["text"], output: ["audio"] })
    }),
  )

  it.live("falls back to a usable window when the gateway advertises none", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      const [glm, measured, aliased] = yield* models(catalog)
      expect(glm!.limit).toEqual({ context: 128_000, output: 32_000 })
      expect(measured!.limit).toEqual({ context: 200_000, output: 64_000 })
      // Read through the aliases v1 also accepts, and floored to an integer.
      expect(aliased!.limit).toEqual({ context: 32_768, output: 4_096 })
    }),
  )

  it.effect("keeps a pending device-auth poll distinguishable from an issued key", () =>
    Effect.sync(() => {
      // Was decoding to `{}` — the error stripped as an excess property — so the
      // poll loop read it as success-without-a-key and failed the login.
      expect(decodeToken({ error: "authorization_pending" }).error).toBe("authorization_pending")
      expect(decodeToken({ error: "slow_down" }).error).toBe("slow_down")
      // A real grant still carries no error and yields the key, under whichever
      // of the three names this gateway version uses.
      expect(decodeToken({ api_key: "sk-1" }).error).toBeUndefined()
      expect(decodeToken({ api_key: "sk-1" }).api_key).toBe("sk-1")
      expect(decodeToken({ access_token: "sk-2" }).access_token).toBe("sk-2")
      expect(decodeToken({ key: "sk-3" }).key).toBe("sk-3")
    }),
  )

  it.live("reads pricing the gateway serves as JSON strings", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()
      const [glm, , aliased] = yield* models(catalog)
      expect(glm!.cost[0]).toEqual({ input: 0.966, output: 3.036, cache: { read: 0, write: 0 } })
      // No pricing at all means free to the caller, not unknown.
      expect(aliased!.cost[0]).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } })
    }),
  )
})
