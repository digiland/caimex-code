import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { finalizeSessionEvents } from "./server-event-compat"

// Envelopes below are what the source-built daemon actually streams (captured from
// GET /api/event), not what the vendored client types claim.
const location = { directory: "/repo" }
const durable = { aggregateID: "ses_1", seq: 1, version: 1 }
const next = (type: string, data: Record<string, unknown>) =>
  ({ id: "evt_1", type, location, durable, data: { timestamp: 1000, sessionID: "ses_1", ...data } }) as unknown as OpenCodeEvent

const types = (events: OpenCodeEvent[]) => events.map((event) => event.type)
const data = (event: OpenCodeEvent) => event.data as Record<string, unknown>

describe("finalizeSessionEvents", () => {
  test("leaves events outside the next namespace alone", () => {
    const event = { id: "evt_1", type: "session.created", data: { sessionID: "ses_1" } } as unknown as OpenCodeEvent
    expect(finalizeSessionEvents(event)).toEqual([event])
  })

  test("hoists the timestamp onto the envelope and keeps id/location/durable", () => {
    const [event] = finalizeSessionEvents(next("session.next.step.started", { assistantMessageID: "msg_a", agent: "build", model: { id: "m", providerID: "caimex" } }))
    expect(event.id).toBe("evt_1")
    expect((event as { created?: number }).created).toBe(1000)
    expect(event.location).toEqual(location)
    expect((event as { durable?: unknown }).durable).toEqual(durable)
    expect(data(event)).not.toHaveProperty("timestamp")
    expect(data(event).sessionID).toBe("ses_1")
  })

  test("turns prompt events into the inbox pair and opens the run", () => {
    const admitted = finalizeSessionEvents(
      next("session.next.prompt.admitted", { messageID: "msg_u", prompt: { text: "hi", files: [] }, delivery: "steer" }),
    )
    expect(types(admitted)).toEqual(["session.input.admitted", "session.execution.started"])
    expect(data(admitted[0])).toEqual({
      sessionID: "ses_1",
      inputID: "msg_u",
      input: { type: "user", data: { text: "hi", files: [], agents: undefined, metadata: undefined } },
    })
    const promoted = finalizeSessionEvents(next("session.next.prompted", { messageID: "msg_u", prompt: { text: "hi" }, delivery: "steer" }))
    expect(types(promoted)).toEqual(["session.input.promoted"])
    expect(data(promoted[0]).inputID).toBe("msg_u")
  })

  test("a step start marks the session busy", () => {
    const events = finalizeSessionEvents(next("session.next.step.started", { assistantMessageID: "msg_a", agent: "build", model: {} }))
    expect(types(events)).toEqual(["session.step.started", "session.execution.started"])
    expect(data(events[0]).assistantMessageID).toBe("msg_a")
  })

  test("a terminal step end closes the run; a tool-calls finish does not", () => {
    const ended = { assistantMessageID: "msg_a", finish: "stop", cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }
    expect(types(finalizeSessionEvents(next("session.next.step.ended", ended)))).toEqual([
      "session.step.ended",
      "session.execution.succeeded",
    ])
    expect(types(finalizeSessionEvents(next("session.next.step.ended", { ...ended, finish: "tool-calls" })))).toEqual([
      "session.step.ended",
    ])
    expect(types(finalizeSessionEvents(next("session.next.step.failed", { assistantMessageID: "msg_a", error: { type: "x", message: "boom" } })))).toEqual([
      "session.step.failed",
      "session.execution.failed",
    ])
  })

  test("part ids become ordinals for text and reasoning", () => {
    const [text] = finalizeSessionEvents(next("session.next.text.delta", { assistantMessageID: "msg_a", textID: "text-2", delta: "po" }))
    expect(text.type).toBe("session.text.delta")
    expect(data(text)).toMatchObject({ assistantMessageID: "msg_a", ordinal: 2, delta: "po" })
    const [reasoning] = finalizeSessionEvents(next("session.next.reasoning.ended", { assistantMessageID: "msg_a", reasoningID: "reasoning-0", text: "t" }))
    expect(reasoning.type).toBe("session.reasoning.ended")
    expect(data(reasoning)).toMatchObject({ ordinal: 0, text: "t" })
  })

  test("flattens the provider block on tool events", () => {
    const [called] = finalizeSessionEvents(
      next("session.next.tool.called", { assistantMessageID: "msg_a", callID: "c1", tool: "bash", input: { cmd: "ls" }, provider: { executed: true, metadata: { p: 1 } } }),
    )
    expect(called.type).toBe("session.tool.called")
    expect(data(called)).toEqual({ sessionID: "ses_1", assistantMessageID: "msg_a", callID: "c1", input: { cmd: "ls" }, executed: true, state: { p: 1 } })
    const [success] = finalizeSessionEvents(
      next("session.next.tool.success", { assistantMessageID: "msg_a", callID: "c1", structured: { s: 1 }, content: [{ type: "text", text: "ok" }], provider: { executed: true } }),
    )
    expect(data(success)).toMatchObject({ callID: "c1", metadata: { s: 1 }, content: [{ type: "text", text: "ok" }], executed: true })
    const [failed] = finalizeSessionEvents(
      next("session.next.tool.failed", { assistantMessageID: "msg_a", callID: "c1", error: { type: "e", message: "no" }, provider: { executed: false } }),
    )
    expect(data(failed)).toMatchObject({ callID: "c1", error: { type: "e", message: "no" }, content: [], executed: false })
  })

  test("nests shell fields the way the reducer reads them", () => {
    const [started] = finalizeSessionEvents(next("session.next.shell.started", { messageID: "msg_s", callID: "sh1", command: "ls" }))
    expect(data(started).shell).toEqual({ id: "sh1", command: "ls", status: "running" })
    const [ended] = finalizeSessionEvents(next("session.next.shell.ended", { callID: "sh1", output: "a\nb" }))
    expect(data(ended)).toMatchObject({ shell: { id: "sh1", status: "completed" }, output: "a\nb" })
  })

  test("passes through next events with no finalized consumer", () => {
    const moved = next("session.next.moved", { location })
    expect(finalizeSessionEvents(moved)).toEqual([moved])
  })
})

describe("finalizeSessionEvents against a captured daemon stream", () => {
  // Recorded from GET /api/event on the source-built daemon while prompting "Reply with
  // exactly the word: pong". Feeds the real reducer, so a vocabulary drift on either side
  // shows up here before it shows up as a session stuck on "Thinking".
  test("reduces to a user message and a completed assistant reply", async () => {
    const { createV2SessionReducer } = await import("@/context/server-session-v2-reducer")
    const stream = (await Bun.file(new URL("./__fixtures__/daemon-session-stream.json", import.meta.url)).json()) as OpenCodeEvent[]

    const reducer = createV2SessionReducer()
    let messages: Parameters<typeof reducer.reduce>[0] = []
    const seen: string[] = []
    let busy: boolean | undefined
    for (const raw of stream) {
      for (const event of finalizeSessionEvents(raw)) {
        seen.push(event.type)
        if (event.type === "session.execution.started") busy = true
        if (event.type === "session.execution.succeeded") busy = false
        const reduction = reducer.reduce(messages, event)
        if (reduction) messages = reduction.messages
      }
    }

    expect(seen).not.toContain(expect.stringMatching(/^session\.next\./))
    expect(busy).toBe(false)

    const user = messages.find((message) => message.type === "user")
    expect(user).toMatchObject({ text: "Reply with exactly the word: pong" })

    const assistant = messages.find((message) => message.type === "assistant")
    expect(assistant).toBeDefined()
    if (assistant?.type !== "assistant") throw new Error("expected assistant")
    expect(assistant.time.completed).toBeDefined()
    expect(assistant.finish).toBe("stop")
    expect(assistant.content.map((part) => part.type)).toEqual(["reasoning", "text"])
    expect(assistant.content.find((part) => part.type === "text")).toMatchObject({ text: "pong" })
  })
})
