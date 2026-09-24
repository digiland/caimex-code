export * as PluginHost from "./host"

import type { PluginContext as Interface } from "@opencode-ai/plugin/v2/effect"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Exit, Option, Schema, Scope, type JsonSchema } from "effect"
import { AgentV2 } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Credential } from "../credential"
import { Integration } from "../integration"
import { ModelV2 } from "../model"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import type { DeepMutable } from "../schema"
import { SkillV2 } from "../skill"
import { PermissionV2 } from "../permission"
import { Location } from "../location"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"

const mutable = <T>(value: T) => value as DeepMutable<T>

export const make = Effect.fn("PluginHost.make")(function* (plugin: PluginV2.Interface) {
  const agents = yield* AgentV2.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const integration = yield* Integration.Service
  const reference = yield* Reference.Service
  const skill = yield* SkillV2.Service
  // Looked up here, where the Location's services are in scope (a plugin's own effects
  // run without them), and optionally, so building the plugin layer alone (tests) still
  // works; the Location node provides all three.
  const tools = Option.getOrUndefined(yield* Effect.serviceOption(Tools.Service))
  const permission = Option.getOrUndefined(yield* Effect.serviceOption(PermissionV2.Service))
  const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))

  return {
    options: {},
    agent: {
      reload: agents.reload,
      transform: (callback) =>
        agents.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(AgentV2.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          }),
        ),
    },
    aisdk: {
      sdk: (callback) =>
        aisdk.hook.sdk((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
            sdk: event.sdk,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        }),
      language: (callback) =>
        aisdk.hook.language((event) => {
          const output = {
            model: mutable(event.model),
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        }),
    },
    catalog: {
      reload: catalog.reload,
      transform: (callback) =>
        catalog.transform((draft) =>
          callback({
            provider: {
              list: () => mutable(draft.provider.list()),
              get: (id) => mutable(draft.provider.get(ProviderV2.ID.make(id))),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              },
            },
          }),
        ),
    },
    command: {
      reload: commands.reload,
      transform: commands.transform,
    },
    integration: {
      reload: integration.reload,
      connection: {
        active: (id) => integration.connection.active(Integration.ID.make(id)),
        resolve: (connection) =>
          integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          ),
      },
      transform: (callback) =>
        integration.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Integration.ID.make(id))),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => mutable(draft.method.list(Integration.ID.make(id))),
              update: (input) => {
                if ("authorize" in input) {
                  const methodID = Integration.MethodID.make(input.method.id)
                  const refresh = input.refresh
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, id: methodID },
                    authorize: (inputs) =>
                      input.authorize(inputs).pipe(
                        Effect.map((authorization) => {
                          if (authorization.mode === "auto") {
                            return {
                              ...authorization,
                              callback: authorization.callback.pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                            }
                          }
                          return {
                            ...authorization,
                            callback: (code: string) =>
                              authorization.callback(code).pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                          }
                        }),
                      ),
                    ...(refresh
                      ? {
                          refresh: (value: Credential.OAuth) =>
                            refresh(value).pipe(
                              Effect.map((next) =>
                                Credential.OAuth.make({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                              ),
                            ),
                        }
                      : {}),
                    ...(input.label ? { label: input.label } : {}),
                  })
                  return
                }
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), Schema.decodeUnknownSync(Integration.Method)(method)),
            },
          }),
        ),
    },
    plugin: {
      add: (input) => plugin.add(PluginV2.ID.make(input.id), input.effect),
      remove: (id) => plugin.remove(PluginV2.ID.make(id)),
    },
    reference: {
      reload: reference.reload,
      transform: (callback) =>
        reference.transform((draft) =>
          callback({
            add: (name, source) => draft.add(name, Schema.decodeUnknownSync(Reference.Source)(source)),
            remove: draft.remove,
            list: draft.list,
          }),
        ),
    },
    // Caimex fork: plugin tools. Upstream plans plugin and MCP tools as separate scoped
    // registrations (see tool/builtins.ts); this is the smallest version of that. Every
    // call is checked against the agent's permission rules first, with the tool's name as
    // the action, so a mode decides whether a plugin tool runs, asks, or is refused.
    tool: {
      register: (specs) =>
        Effect.gen(function* () {
          if (!tools || !permission) return yield* Effect.die(new Error("Plugin tools aren't available here"))
          const registered = Object.fromEntries(
            Object.entries(specs).map(([name, spec]) => [
              name,
              Tool.fromJsonSchema({
                description: spec.description,
                parameters: spec.parameters as JsonSchema.JsonSchema,
                execute: (input, context) =>
                  Effect.gen(function* () {
                    const resources = (() => {
                      try {
                        return [...(spec.resources?.(input) ?? ["*"])]
                      } catch {
                        return ["*"]
                      }
                    })()
                    yield* permission
                      .assert({
                        action: name,
                        resources,
                        // "Always allow" remembers these resources, e.g. one API host.
                        save: resources,
                        metadata: input && typeof input === "object" ? (input as Record<string, unknown>) : { input },
                        sessionID: context.sessionID,
                        agent: context.agent,
                        source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                      })
                      .pipe(Effect.mapError(() => new ToolFailure({ message: `Permission denied: ${name}` })))
                    return yield* Effect.suspend(() =>
                      spec.execute(input, {
                        directory: location?.directory ?? process.cwd(),
                        sessionID: context.sessionID,
                        agent: context.agent,
                        callID: context.toolCallID,
                      }),
                    ).pipe(
                      Effect.catchDefect((defect) => Effect.fail(defect)),
                      Effect.mapError(
                        (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
                      ),
                    )
                  }),
              }),
            ]),
          )
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          yield* tools.register(registered).pipe(Scope.provide(scope), Effect.orDie)
          return { dispose: Scope.close(scope, Exit.void) }
        }),
    },
    skill: {
      reload: skill.reload,
      transform: (callback) =>
        skill.transform((draft) =>
          callback({
            source: (source) => draft.source(Schema.decodeUnknownSync(SkillV2.Source)(source)),
            list: draft.list,
          }),
        ),
    },
  } satisfies Interface
})
