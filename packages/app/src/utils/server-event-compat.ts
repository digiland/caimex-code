import type { OpenCodeEvent } from "@opencode-ai/client/promise"

// The daemon this desktop runs is built from this repo's packages/core, which still
// streams the transitional `session.next.*` vocabulary. This renderer, and the vendored
// client it compiles against, speak the finalized `session.*` one: different names, the
// timestamp on the envelope rather than in `data`, part ordinals instead of part ids,
// an inbox admitted/promoted pair instead of prompt events, and `session.execution.*`
// lifecycle events that core does not emit at all (the TUI derives busy from an
// in-flight assistant message instead). Upstream never meets this gap because its
// desktop pins a prebuilt daemon snapshot; we build ours from source.
//
// Translate here so the reducer sees the events it was written for. Once core finalizes
// its names nothing carries the prefix and this becomes a pass-through.

const PREFIX = "session.next."

type NextEvent = {
  id: string
  type: string
  data: Record<string, unknown> & { sessionID: string; timestamp: number }
  location?: unknown
  durable?: unknown
}

type Provider = { executed?: boolean; metadata?: unknown } | undefined

export function finalizeSessionEvents(event: OpenCodeEvent): OpenCodeEvent[] {
  const type: string = event.type
  if (!type.startsWith(PREFIX)) return [event]

  const source = event as unknown as NextEvent
  const name = type.slice(PREFIX.length)
  const { timestamp, sessionID, ...fields } = source.data
  const out = (type: string, data: Record<string, unknown>) =>
    ({
      id: source.id,
      type,
      created: timestamp,
      location: source.location,
      durable: source.durable,
      data: { sessionID, ...data },
    }) as unknown as OpenCodeEvent
  const provider = fields.provider as Provider

  switch (name) {
    case "prompt.admitted": {
      const prompt = fields.prompt as { text?: string; files?: unknown; agents?: unknown; metadata?: unknown } | undefined
      return [
        out("session.input.admitted", {
          inputID: fields.messageID,
          input: {
            type: "user",
            data: { text: prompt?.text ?? "", files: prompt?.files, agents: prompt?.agents, metadata: prompt?.metadata },
          },
        }),
        out("session.execution.started", {}),
      ]
    }
    case "prompted":
      return [out("session.input.promoted", { inputID: fields.messageID })]
    case "agent.switched":
      return [out("session.agent.selected", { agent: fields.agent })]
    case "model.switched":
      return [out("session.model.selected", { model: fields.model })]
    case "synthetic":
      return [out("session.synthetic", { text: fields.text })]
    case "shell.started":
      return [out("session.shell.started", { shell: { id: fields.callID, command: fields.command, status: "running" } })]
    case "shell.ended":
      return [out("session.shell.ended", { shell: { id: fields.callID, status: "completed" }, output: fields.output })]
    case "step.started":
      return [out("session.step.started", fields), out("session.execution.started", {})]
    case "step.ended":
      // A "tool-calls" finish means core is about to open another step; anything else ends the run.
      return fields.finish === "tool-calls"
        ? [out("session.step.ended", fields)]
        : [out("session.step.ended", fields), out("session.execution.succeeded", {})]
    case "step.failed":
      return [out("session.step.failed", fields), out("session.execution.failed", {})]
    case "text.started":
    case "text.delta":
    case "text.ended":
      return [out(`session.${name}`, { ...fields, ordinal: ordinal(fields.textID) })]
    case "reasoning.started":
    case "reasoning.delta":
    case "reasoning.ended":
      return [out(`session.${name}`, { ...fields, ordinal: ordinal(fields.reasoningID) })]
    case "tool.input.started":
    case "tool.input.delta":
    case "tool.input.ended":
      return [out(`session.${name}`, fields)]
    case "tool.called":
      return [
        out("session.tool.called", {
          assistantMessageID: fields.assistantMessageID,
          callID: fields.callID,
          input: fields.input,
          executed: provider?.executed,
          state: provider?.metadata,
        }),
      ]
    case "tool.progress":
      return [
        out("session.tool.progress", {
          assistantMessageID: fields.assistantMessageID,
          callID: fields.callID,
          metadata: fields.structured,
        }),
      ]
    case "tool.success":
      return [
        out("session.tool.success", {
          assistantMessageID: fields.assistantMessageID,
          callID: fields.callID,
          content: fields.content,
          metadata: fields.structured,
          executed: provider?.executed,
          resultState: provider?.metadata,
        }),
      ]
    case "tool.failed":
      return [
        out("session.tool.failed", {
          assistantMessageID: fields.assistantMessageID,
          callID: fields.callID,
          error: fields.error,
          content: [],
          executed: provider?.executed,
          resultState: provider?.metadata,
        }),
      ]
    case "compaction.started":
      return [out("session.compaction.started", { inputID: fields.messageID, reason: fields.reason })]
    case "compaction.delta":
      return [out("session.compaction.delta", { text: fields.text })]
    case "compaction.ended":
      return [out("session.compaction.ended", { reason: fields.reason, text: fields.text, recent: fields.recent })]
    default:
      // moved, context.updated, revert.*, retried: nothing downstream reads these under
      // a finalized name (home-session-index keys on `session.next.moved` directly).
      return [event]
  }
}

// Core identifies streamed parts as `text-3` / `reasoning-0`; the reducer addresses them
// by their index among parts of the same type, which is that suffix.
function ordinal(id: unknown) {
  if (typeof id !== "string") return 0
  const value = Number(id.slice(id.lastIndexOf("-") + 1))
  return Number.isFinite(value) ? value : 0
}
