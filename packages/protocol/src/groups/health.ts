import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const HealthGroup = HttpApiGroup.make("server.health").add(
  HttpApiEndpoint.get("health.get", "/api/health", {
    // `pid` is how a client tells a v2 server from a v1 one: v1's health payload
    // is `{healthy: true}` too, so healthiness alone is not a discriminator, and
    // detectServerProtocol in packages/app has always looked for a numeric pid
    // here. Without it every v2 server was misread as v1 and then addressed on
    // v1's routes, which 404 — the desktop could not load a session against its
    // own sidecar.
    success: Schema.Struct({ healthy: Schema.Literal(true), pid: Schema.Number }),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.health.get",
      summary: "Check server health",
      description: "Check whether the API server is ready to accept requests.",
    }),
  ),
)
