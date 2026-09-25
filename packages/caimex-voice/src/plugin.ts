import { Plugin } from "@opencode/plugin"
import { CaimexVoice, VOICES } from "../rpc.ts"
import { credential, GatewayError, speak, transcribe } from "./gateway.ts"
import { clip, lastReply, speakable, voicePrompt } from "./prompt.ts"

// Turn-by-turn voice for Caimex Desktop. The design follows opencode-gpt-live (MIT): a
// hidden voice-agent session per working session, which talks with the user and drives
// the working session through a few tools. What differs is the audio: instead of a
// realtime call to OpenAI, the app records a turn, the gateway transcribes it, the voice
// agent answers, and the gateway reads the answer out. Everything goes through Caimex.

interface Options {
  voice?: string
  /** Voice agent model, as "provider/model". Defaults to the session's default model. */
  voiceModel?: string
  transcribeModel?: string
  speechModel?: string
}

const AGENT_ID = "caimex-voice"
const TOOL_PREFIX = "voice_"

type Link = { voiceSessionID: string }

type Watch = {
  mainSessionID: string
  voiceSessionID: string
  // A task the voice agent sent is running or queued: its outcome gets announced.
  pending: number
  mainText: string
}

function parseModel(value: string | undefined) {
  if (!value) return undefined
  const slash = value.indexOf("/")
  return slash > 0 ? { providerID: value.slice(0, slash), id: value.slice(slash + 1) } : undefined
}

export default Plugin.define({
  id: "caimex-voice",
  async setup(ctx) {
    const options = ctx.options as Options
    const voiceModel = parseModel(options.voiceModel)
    const project = ctx.location.project.canonical.split(/[\\/]/).findLast(Boolean) ?? "project"
    const prompt = voicePrompt({ project, directory: ctx.location.directory })

    // Working sessions with voice turned on, by id, and the reverse lookup for tools.
    const watches = new Map<string, Watch>()
    const byVoice = new Map<string, Watch>()

    // The voice agent: it only talks and delegates, so every other tool is off for it.
    await ctx.agent.transform((editor) => {
      editor.update(AGENT_ID, (agent) => {
        agent.name = "Voice" as never
        agent.description = "Talks with you out loud and drives your session (Caimex Desktop voice)."
        agent.system = prompt
        agent.mode = "primary"
        agent.hidden = true
        agent.permissions = [
          { action: "*", resource: "*", effect: "deny" },
          { action: `${TOOL_PREFIX}*`, resource: "*", effect: "allow" },
        ] as never
      })
    })

    const outside = { content: "This tool only works in a Caimex voice conversation." }
    await ctx.tool.transform((editor) => {
      const tool = (definition: {
        name: string
        description: string
        input: Record<string, unknown>
        run: (watch: Watch, input: Record<string, unknown>) => Promise<string> | string
      }) =>
        editor.add({
          name: `${TOOL_PREFIX}${definition.name}`,
          description: definition.description,
          input: definition.input as never,
          options: { codemode: false },
          execute: async (input, context) => {
            const watch = byVoice.get(context.sessionID)
            if (!watch) return outside
            try {
              return { content: await definition.run(watch, (input ?? {}) as Record<string, unknown>) }
            } catch (error) {
              return { content: `Failed: ${error instanceof Error ? error.message : String(error)}` }
            }
          },
        })

      tool({
        name: "send",
        description:
          "Send a task or message to the user's working session. Write a clear, self-contained brief of what the user means.",
        input: {
          type: "object",
          properties: {
            text: { type: "string", description: "A clear brief: goal, specifics and constraints, and what a good result looks like." },
            delivery: {
              type: "string",
              enum: ["queue", "steer"],
              description: "queue (default): run after current work. steer: redirect the work already running.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
        run: async (watch, input) => {
          const text = String(input.text ?? "").trim()
          if (!text) throw new Error("text is empty; write the brief you want to send")
          const delivery = input.delivery === "steer" ? "steer" : "queue"
          await ctx.session.prompt({ sessionID: watch.mainSessionID as never, text, delivery } as never)
          watch.pending++
          return delivery === "steer"
            ? "Sent into the session's current work. The outcome will be announced when it finishes."
            : "Sent to the session. The result will be announced when it's done."
        },
      })
      tool({
        name: "status",
        description: "Check whether the working session is busy, and its last reply.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: async (watch) => {
          const messages = (await ctx.session.context({ sessionID: watch.mainSessionID as never })) as readonly unknown[]
          const last = lastReply(messages)
          return [
            watch.pending > 0 ? "The session is working on what you sent." : "The session isn't working on anything you sent.",
            last ? `Its last reply: ${clip(speakable(last), 800)}` : "It hasn't replied yet.",
          ].join("\n")
        },
      })
      tool({
        name: "read",
        description: "Read the working session's recent conversation, including which tools it used.",
        input: {
          type: "object",
          properties: { turns: { type: "number", description: "How many recent turns (default 6)." } },
          additionalProperties: false,
        },
        run: async (watch, input) => {
          const messages = (await ctx.session.context({ sessionID: watch.mainSessionID as never })) as readonly Record<
            string,
            unknown
          >[]
          const lines: string[] = []
          for (const message of messages) {
            if (message.type === "user" && typeof message.text === "string") lines.push(`User: ${clip(message.text.trim(), 400)}`)
            else if (message.type === "assistant" && Array.isArray(message.content)) {
              const parts = message.content as Record<string, unknown>[]
              const tools = [...new Set(parts.filter((part) => part.type === "tool").map((part) => String(part.name)))]
              const text = parts
                .filter((part) => part.type === "text" && typeof part.text === "string")
                .map((part) => part.text as string)
                .join("\n")
                .trim()
              if (tools.length) lines.push(`Agent used: ${tools.join(", ")}`)
              if (text) lines.push(`Agent: ${clip(speakable(text, 1_200), 1_200)}`)
            }
          }
          const turns = typeof input.turns === "number" ? Math.max(1, Math.min(input.turns, 20)) : 6
          const recent = lines.slice(-turns * 2)
          return recent.length ? recent.join("\n") : "The session has no messages yet."
        },
      })
      tool({
        name: "stop",
        description: "Stop the working session's current work.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: async (watch) => {
          await ctx.session.interrupt({ sessionID: watch.mainSessionID as never, resume: false } as never)
          watch.pending = 0
          return "Stopped the session's work."
        },
      })
      tool({
        name: "permissions",
        description: "List permission requests the working session is waiting on.",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: async (watch) => {
          const requests = (await ctx.permission
            .list({ sessionID: watch.mainSessionID as never })
            .catch(() => [])) as readonly { id: string; action: string; resources: readonly string[] }[]
          if (!requests.length) return "The session isn't waiting on any permission."
          return requests.map((request) => `- id ${request.id}: wants to ${request.action} ${request.resources.join(", ")}`).join("\n")
        },
      })
      tool({
        name: "permission_reply",
        description: "Answer a pending permission request after the user decides.",
        input: {
          type: "object",
          properties: {
            requestID: { type: "string" },
            decision: { type: "string", enum: ["once", "always", "reject"] },
          },
          required: ["requestID", "decision"],
          additionalProperties: false,
        },
        run: async (watch, input) => {
          const decision = input.decision === "always" ? "always" : input.decision === "reject" ? "reject" : "once"
          await ctx.permission.reply({
            sessionID: watch.mainSessionID as never,
            requestID: String(input.requestID) as never,
            decision,
          } as never)
          return decision === "reject" ? "Rejected it." : `Allowed it (${decision}).`
        },
      })
    })

    // Only voice sessions see the voice tools, and they see nothing else.
    const shape = (event: { sessionID: string; tools: Record<string, unknown> }) => {
      const voice = byVoice.has(event.sessionID)
      for (const name of Object.keys(event.tools)) {
        const own = name.startsWith(TOOL_PREFIX)
        if (voice ? !own : own) delete event.tools[name]
      }
    }
    await ctx.session.hook("context", (event) => shape(event as never))
    await ctx.session.hook("generate", (event) => shape(event as never))

    // One voice session per working session, kept across conversations.
    const voiceSessionFor = async (mainSessionID: string) => {
      const key = `link/${mainSessionID}`
      const link = (await ctx.storage.get(key)) as Link | undefined
      if (link) {
        const exists = await ctx.session.get({ sessionID: link.voiceSessionID as never }).catch(() => undefined)
        if (exists) return link.voiceSessionID
      }
      const main = (await ctx.session.get({ sessionID: mainSessionID as never }).catch(() => undefined)) as
        | { title?: string }
        | undefined
      const created = (await ctx.session.create({
        title: `Voice · ${main?.title ?? "session"}`,
        agent: AGENT_ID,
        ...(voiceModel ? { model: voiceModel } : {}),
        metadata: { caimexVoice: { role: "voice", mainSessionID } },
      } as never)) as { id: string }
      await ctx.storage.set(key, { voiceSessionID: created.id })
      return created.id
    }

    // Asks the voice agent for a reply and waits for it.
    const ask = async (voiceSessionID: string, text: string) => {
      await ctx.session.prompt({ sessionID: voiceSessionID as never, text, delivery: "queue" } as never)
      await ctx.session.wait({ sessionID: voiceSessionID as never } as never)
      const messages = (await ctx.session.context({ sessionID: voiceSessionID as never })) as readonly unknown[]
      return speakable(lastReply(messages), 1_200)
    }

    const registration = await ctx.rpc.register(CaimexVoice, {
      start: async (input, { error }) => {
        const key = await credential(ctx)
        if (!key) return error("not_signed_in", "Sign in to Caimex first.", { reason: "Sign in to Caimex first." })
        const voiceSessionID = await voiceSessionFor(input.sessionID)
        const watch: Watch = watches.get(input.sessionID) ?? {
          mainSessionID: input.sessionID,
          voiceSessionID,
          pending: 0,
          mainText: "",
        }
        watch.voiceSessionID = voiceSessionID
        watches.set(input.sessionID, watch)
        byVoice.set(voiceSessionID, watch)
        return { voiceSessionID, signedIn: true }
      },
      stop: async (input) => {
        const watch = watches.get(input.sessionID)
        if (watch) byVoice.delete(watch.voiceSessionID)
        return { stopped: watches.delete(input.sessionID) }
      },
      transcribe: async (input, { error }) => {
        const key = await credential(ctx)
        if (!key) return error("gateway", "Sign in to Caimex first.", { status: 401, message: "Sign in to Caimex first." })
        try {
          const text = await transcribe(key, {
            audio: Buffer.from(input.audio, "base64"),
            mime: input.mime ?? "audio/wav",
            language: input.language,
            model: options.transcribeModel ?? "whisper-1",
          })
          return { text }
        } catch (cause) {
          const status = cause instanceof GatewayError ? cause.status : 0
          const message = cause instanceof Error ? cause.message : String(cause)
          return error("gateway", message, { status, message })
        }
      },
      turn: async (input, { error }) => {
        const watch = watches.get(input.sessionID)
        if (!watch) return error("not_started", "Voice isn't on for this session.", { reason: "Voice isn't on for this session." })
        const reply = await ask(watch.voiceSessionID, input.text)
        return { reply: reply || "Sorry, I didn't catch that." }
      },
      speak: async (input, { error }) => {
        const key = await credential(ctx)
        if (!key) return error("gateway", "Sign in to Caimex first.", { status: 401, message: "Sign in to Caimex first." })
        const voice = input.voice ?? (VOICES.includes(options.voice as never) ? options.voice! : "nova")
        try {
          const audio = await speak(key, { text: clip(input.text, 3_000), voice, model: options.speechModel ?? "tts-1" })
          return { audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }
        } catch (cause) {
          const status = cause instanceof GatewayError ? cause.status : 0
          const message = cause instanceof Error ? cause.message : String(cause)
          return error("gateway", message, { status, message })
        }
      },
    })

    const emit = registration.events.emit
    // Announce results of work the voice agent sent, and permission requests, for
    // sessions with voice on. The voice agent phrases each result, as GPT-Live's does.
    const abort = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: abort.signal } as never)) {
          const data = (event as { data?: Record<string, unknown> }).data
          const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
          const watch = sessionID ? watches.get(sessionID) : undefined
          if (!watch || !data) continue
          const type = (event as { type: string }).type
          if (type === "session.execution.started") {
            watch.mainText = ""
            void emit("activity", { sessionID: watch.mainSessionID, scope: "main", busy: true, label: "working" })
          } else if (type === "session.tool.input.started" && typeof data.name === "string") {
            void emit("activity", { sessionID: watch.mainSessionID, scope: "main", busy: true, label: data.name })
          } else if (type === "session.text.ended" && typeof data.text === "string" && data.text.trim()) {
            watch.mainText = data.text
          } else if (type === "permission.asked") {
            const resources = Array.isArray(data.resources) ? (data.resources as string[]).join(", ") : ""
            void emit("announce", {
              sessionID: watch.mainSessionID,
              text: `The session needs permission to ${String(data.action ?? "continue")}${resources ? ` ${clip(resources, 120)}` : ""}. Say allow once, always allow, or reject.`,
            })
          } else if (
            type === "session.execution.succeeded" ||
            type === "session.execution.failed" ||
            type === "session.execution.interrupted"
          ) {
            void emit("activity", { sessionID: watch.mainSessionID, scope: "main", busy: false })
            if (watch.pending <= 0) continue
            watch.pending--
            const failed = type === "session.execution.failed"
            const detail = failed
              ? `It failed: ${clip((data.error as { message?: string } | undefined)?.message ?? "unknown error", 300)}`
              : type === "session.execution.interrupted"
                ? "It was stopped."
                : `Its reply: ${clip(speakable(watch.mainText, 3_000), 3_000)}`
            const reply = await ask(
              watch.voiceSessionID,
              `<session_update>The work you sent has finished. ${detail}</session_update>\nTell the user the outcome in one or two short spoken sentences.`,
            ).catch(() => "")
            if (reply) void emit("announce", { sessionID: watch.mainSessionID, text: reply })
          }
        }
      } catch {
        // the event stream ended with the plugin
      }
    })()

    return async () => {
      abort.abort()
      await registration.dispose()
    }
  },
})
