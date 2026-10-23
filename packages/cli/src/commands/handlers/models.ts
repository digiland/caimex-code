import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.models,
  Effect.fn("cli.models")(function* () {
    const server = yield* ServerConnection.resolve()
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const list = () => Effect.promise(() => client.model.list({ location: { directory: process.cwd() } }))
    let response = yield* list()
    // Caimex: a service that just started answers before its provider plugins have
    // loaded and before the gateway's catalog arrives, so a list without Caimex models is
    // asked again for a few seconds before it's believed (a local Ollama alone used to
    // end the wait early).
    const ready = () => response.data.some((model) => model.providerID === "caimex")
    for (let attempt = 0; attempt < 10 && !ready(); attempt++) {
      yield* Effect.sleep("500 millis")
      response = yield* list()
    }
    const models = response.data
      .map((model) => `${model.providerID}/${model.id}`)
      .toSorted((a, b) => a.localeCompare(b))
    if (models.length > 0) process.stdout.write(models.join(EOL) + EOL)
  }),
)
