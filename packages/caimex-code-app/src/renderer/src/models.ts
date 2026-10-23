import type { Model } from "./api"

// The gateway's catalog marks every model as tool-capable and most as text-out, so
// capabilities alone can't tell a chat model from an embedder or a transcriber. The
// name can; anything this misjudges is still reachable through "Show all".
const NOT_CHAT = /(embed|rerank|bge-|transcri|whisper|\bstt\b|tts|audio|realtime|image)/i

export function isChatModel(model: Model) {
  const output = model.capabilities?.output
  if (output && !output.includes("text")) return false
  return !NOT_CHAT.test(model.id)
}

export function contextLabel(model: Model) {
  const context = model.limit?.context
  if (!context) return undefined
  return context >= 1_000_000 ? `${Math.round(context / 1_048_576)}M` : `${Math.round(context / 1024)}k`
}
