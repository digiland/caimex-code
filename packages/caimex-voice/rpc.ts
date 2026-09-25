import type { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

// Type-only stand-in for Rpc.define, so the app bundle doesn't pull in the schema runtime
// (the same trick opencode-gpt-live uses).
function define<const D extends Rpc.PortableDefinition>(definition: D): D {
  return definition
}

export const VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const

/**
 * Contract between the app (microphone, speaker, UI) and the server plugin (gateway
 * credentials, the voice agent, the session it drives). Audio travels as base64.
 */
export const CaimexVoice = define({
  id: "caimexvoice",
  methods: {
    /** The app turned voice on for a session; announcements for it start flowing. */
    start: {
      input: z.object({ sessionID: z.string() }),
      output: z.object({ voiceSessionID: z.string(), signedIn: z.boolean() }),
      errors: { not_signed_in: z.object({ reason: z.string() }) },
    },
    stop: {
      input: z.object({ sessionID: z.string() }),
      output: z.object({ stopped: z.boolean() }),
    },
    /** Speech to text. `audio` is a base64 WAV (or any format the gateway's model accepts). */
    transcribe: {
      input: z.object({ audio: z.string(), mime: z.string().optional(), language: z.string().optional() }),
      output: z.object({ text: z.string() }),
      errors: { gateway: z.object({ status: z.number(), message: z.string() }) },
    },
    /** One conversational turn: the user's words in, the voice agent's spoken reply out. */
    turn: {
      input: z.object({ sessionID: z.string(), text: z.string() }),
      output: z.object({ reply: z.string() }),
      errors: { not_started: z.object({ reason: z.string() }) },
    },
    /** Text to speech: base64 MP3. */
    speak: {
      input: z.object({ text: z.string(), voice: z.enum(VOICES).optional() }),
      output: z.object({ audio: z.string(), mime: z.string() }),
      errors: { gateway: z.object({ status: z.number(), message: z.string() }) },
    },
  },
  events: {
    /** Something to say without being asked: a task finished, or a permission is needed. */
    announce: {
      schema: z.object({ sessionID: z.string(), text: z.string() }),
    },
    /** What the voice agent or the main session is doing, for the UI. */
    activity: {
      schema: z.object({
        sessionID: z.string(),
        scope: z.enum(["voice", "main"]),
        busy: z.boolean(),
        label: z.string().optional(),
      }),
    },
  },
})
