import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { response } from "../location"

const authorize = <A, R>(effect: Effect.Effect<A, Integration.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new InvalidRequestError({
          message: "Authentication failed",
          kind: "integration_authorization",
        }),
    ),
  )

// Shared by both spellings of the OAuth attempt routes. Only the params differ
// between them, and both carry `attemptID`, so one implementation serves both.
const attemptStatus = Effect.fn(function* (ctx: { readonly params: { readonly attemptID: Integration.AttemptID } }) {
  const service = yield* Integration.Service
  return yield* response(service.attempt.status(ctx.params.attemptID))
})

const attemptComplete = Effect.fn(function* (ctx: {
  readonly params: { readonly attemptID: Integration.AttemptID }
  readonly payload: { readonly code?: string | undefined }
}) {
  const service = yield* Integration.Service
  yield* service.attempt.complete({ attemptID: ctx.params.attemptID, code: ctx.payload.code }).pipe(
    Effect.mapError(
      (error) =>
        new InvalidRequestError({
          message:
            error._tag === "Integration.CodeRequired" ? "Authorization code is required" : "Authentication failed",
          kind: error._tag === "Integration.CodeRequired" ? "integration_code_required" : "integration_authorization",
        }),
    ),
  )
  return HttpApiSchema.NoContent.make()
})

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "integration.list",
        Effect.fn(function* () {
          const service = yield* Integration.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.get(ctx.params.integrationID))
        }),
      )
      .handle(
        "integration.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* authorize(
            service.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              label: ctx.payload.label,
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.connect.oauth",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.connection.oauth({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                inputs: ctx.payload.inputs,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle("integration.attempt.status", attemptStatus)
      // caimex: the same attempt addressed under its integration, which is how
      // the vendored client spells it — see the note in the protocol group.
      .handle("integration.connect.oauth.status", attemptStatus)
      .handle("integration.attempt.complete", attemptComplete)
      .handle("integration.connect.oauth.complete", attemptComplete)
      .handle(
        "integration.attempt.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.cancel(ctx.params.attemptID)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
