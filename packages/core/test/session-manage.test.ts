import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable, PartTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = ModelV2.Ref.make({ id: ModelV2.ID.make("m"), providerID: ProviderV2.ID.make("caimex") })

const row = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie)
  })

// A v1-engine message with one text part, written the way the v1 projector stores them.
const v1Message = (sessionID: SessionV2.ID, id: string, created: number, text: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(MessageTable)
      .values({ id: id as never, session_id: sessionID, time_created: created, data: { role: "user", time: { created } } as never })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(PartTable)
      .values({
        id: `prt_${id}` as never,
        message_id: id as never,
        session_id: sessionID,
        time_created: created,
        data: { type: "text", text } as never,
      })
      .run()
      .pipe(Effect.orDie)
  })

describe("SessionV2.rename", () => {
  it.effect("changes the title and nothing else", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location, agent: AgentV2.ID.make("plan"), model })
      const before = yield* row(created.id)

      yield* session.rename({ sessionID: created.id, title: "Fix the login flow" })
      const after = yield* row(created.id)

      expect(after?.title).toBe("Fix the login flow")
      // session.updated rewrites every column; all but title and time_updated must survive.
      const { title: _a, time_updated: _b, ...kept } = before!
      const { title: _c, time_updated: _d, ...still } = after!
      expect(still).toEqual(kept)
      expect(after!.time_updated).toBeGreaterThanOrEqual(before!.time_updated)
    }),
  )

  it.effect("fails for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const error = yield* session.rename({ sessionID: SessionV2.ID.create(), title: "x" }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SessionV2.NotFoundError)
    }),
  )
})

describe("SessionV2.remove", () => {
  it.effect("removes the session, its children and everything stored under them", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ location })
      const other = yield* session.create({ location })
      yield* db.update(SessionTable).set({ parent_id: parent.id }).where(eq(SessionTable.id, child.id)).run().pipe(Effect.orDie)
      yield* v1Message(parent.id, "msg_parent", 1, "old history")
      yield* v1Message(child.id, "msg_child", 2, "child history")
      yield* db
        .insert(SessionMessageTable)
        .values({ id: "msg_v2" as never, session_id: parent.id, type: "user", seq: 0, data: {} as never })
        .run()
        .pipe(Effect.orDie)

      yield* session.remove(parent.id)

      expect(yield* row(parent.id)).toBeUndefined()
      expect(yield* row(child.id)).toBeUndefined()
      expect(yield* row(other.id)).toBeDefined()
      expect(yield* db.select().from(MessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(PartTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect(yield* db.select().from(SessionMessageTable).all().pipe(Effect.orDie)).toHaveLength(0)
      expect((yield* session.list()).map((item) => item.id)).toEqual([other.id])
    }),
  )

  it.effect("fails for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const error = yield* session.remove(SessionV2.ID.create()).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SessionV2.NotFoundError)
    }),
  )
})

describe("SessionV2.legacyMessages", () => {
  it.effect("returns v1 history oldest first, with parts and ids restored", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* v1Message(created.id, "msg_b", 20, "second")
      yield* v1Message(created.id, "msg_a", 10, "first")

      const page = yield* session.legacyMessages({ sessionID: created.id })

      expect(page.hasMore).toBe(false)
      expect(page.messages.map((message) => message.info.id)).toEqual(["msg_a", "msg_b"])
      expect(page.messages[0].info).toMatchObject({ id: "msg_a", sessionID: created.id, role: "user" })
      expect(page.messages[0].parts).toEqual([
        { type: "text", text: "first", id: "prt_msg_a", sessionID: created.id, messageID: "msg_a" },
      ])
    }),
  )

  it.effect("pages from the newest end", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      for (const n of [1, 2, 3]) yield* v1Message(created.id, `msg_${n}`, n, String(n))

      const page = yield* session.legacyMessages({ sessionID: created.id, limit: 2 })

      expect(page.hasMore).toBe(true)
      expect(page.messages.map((message) => message.info.id)).toEqual(["msg_2", "msg_3"])
    }),
  )
})
