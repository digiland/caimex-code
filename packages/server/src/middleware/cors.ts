import { Effect } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { CorsConfig, isAllowedCorsOrigin } from "../cors"

// The v2 API emitted no CORS headers at all and answered every preflight with a
// 404, so any browser-origin client was blocked outright: an authenticated call
// carries an Authorization header, which makes it a preflighted request, which
// never got past OPTIONS. That is the whole desktop renderer — `oc://renderer`
// in a packaged app, `http://localhost:<port>` under `bun run dev`. v1 has
// always configured CORS (see the `cors` option in the desktop's sidecar), and
// v2 needs the same to be usable from anything but curl.
//
// Which origins are allowed is not decided here: isAllowedCorsOrigin already
// owns that answer for the PTY websocket handshake, and the two must agree.
const ALLOWED_METHODS = "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS"
const MAX_AGE = "600"

export const corsMiddleware = HttpMiddleware.make((httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const config = yield* CorsConfig
    const origin = request.headers["origin"]

    // No origin is a same-origin or non-browser request — nothing to grant, and
    // a disallowed origin gets the response with no CORS headers, which is what
    // makes the browser refuse it.
    if (origin === undefined || !isAllowedCorsOrigin(origin, config)) return yield* httpEffect

    const allow = {
      "access-control-allow-origin": origin,
      vary: "Origin",
    }

    // Only a real preflight is answered here. A plain OPTIONS still routes, so
    // an endpoint that wants the method later keeps it.
    const requestedMethod = request.headers["access-control-request-method"]
    if (request.method === "OPTIONS" && requestedMethod !== undefined) {
      return HttpServerResponse.empty({
        status: 204,
        headers: {
          ...allow,
          "access-control-allow-methods": ALLOWED_METHODS,
          // Echo what was asked for rather than keeping a list in step with
          // every header the SDK sends — the origin check above is the gate.
          "access-control-allow-headers": request.headers["access-control-request-headers"] ?? "authorization",
          "access-control-max-age": MAX_AGE,
        },
      })
    }

    return HttpServerResponse.setHeaders(yield* httpEffect, allow)
  }),
)
