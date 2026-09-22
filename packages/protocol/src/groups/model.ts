import { Model } from "@opencode-ai/schema/model"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const ModelGroup = HttpApiGroup.make("server.model")
  .add(
    HttpApiEndpoint.get("model.list", "/api/model", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.list",
          summary: "List models",
          description: "Retrieve available models ordered by release date.",
        }),
      ),
  )
  .add(
    // The client has always called this — it is how the composer preselects a
    // model instead of opening on an empty "Select model". The v2 server never
    // implemented it, so the call 404'd, and because the app fetches providers,
    // models and the default together, that one rejection emptied the whole
    // provider list: no models anywhere in the UI. `Catalog.model.default()`
    // already answers this in core; nothing needed inventing.
    HttpApiEndpoint.get("model.default", "/api/model/default", {
      query: LocationQuery,
      // Null rather than a 404 when nothing qualifies: "no default yet" is an
      // ordinary state on a catalog the user has not connected to.
      success: Location.response(Schema.NullOr(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.default",
          summary: "Get the default model",
          description: "Retrieve the model a new session starts on, or null when none is available.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "models",
      description: "Experimental model routes.",
    }),
  )
