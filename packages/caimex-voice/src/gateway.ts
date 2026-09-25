import type { Plugin } from "@opencode/plugin"

// Speech through the Caimex gateway, with the Caimex sign-in the daemon already holds; the
// key never leaves the daemon. Same endpoints as the CAIMEx mobile apps
// (caimex-mobile/PROTOCOL.md): /v1/audio/transcriptions and /v1/audio/speech.
const DEFAULT_API_BASE_URL = "https://caimex.econetai.co.zw:2052/v1"
const apiBase = () => (process.env["CAIMEX_API_BASE_URL"] ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "")
// The gateway identifies Caimex Code clients by this User-Agent.
const USER_AGENT = "caimex-code"

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function credential(ctx: Plugin.Context): Promise<string | undefined> {
  const active = await ctx.integration.connection.active("caimex").catch(() => undefined)
  if (active) {
    const resolved = (await ctx.integration.connection.resolve(active as never).catch(() => undefined)) as
      | { type?: string; access?: string; key?: string }
      | undefined
    const key = resolved?.type === "oauth" ? resolved.access : resolved?.key
    if (key) return key
  }
  return process.env["CAIMEX_API_KEY"] || undefined
}

async function failure(response: Response) {
  const body = await response.text().catch(() => "")
  let detail = body.slice(0, 300)
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: { message?: string } | string }
    detail =
      (typeof parsed.detail === "string" && parsed.detail) ||
      (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ||
      detail
  } catch {
    // not JSON
  }
  return new GatewayError(response.status, `The gateway answered ${response.status}${detail ? `: ${detail}` : ""}`)
}

export async function transcribe(key: string, input: { audio: Uint8Array; mime: string; language?: string; model: string }) {
  const form = new FormData()
  const extension = input.mime.includes("wav") ? "wav" : input.mime.includes("webm") ? "webm" : "mp3"
  form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.mime }), `speech.${extension}`)
  form.append("model", input.model)
  if (input.language) form.append("language", input.language)
  const response = await fetch(`${apiBase()}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "User-Agent": USER_AGENT },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw await failure(response)
  const body = (await response.json()) as { text?: string }
  return (body.text ?? "").trim()
}

export async function speak(key: string, input: { text: string; voice: string; model: string }) {
  const response = await fetch(`${apiBase()}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "User-Agent": USER_AGENT, "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, input: input.text, voice: input.voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw await failure(response)
  return new Uint8Array(await response.arrayBuffer())
}
