import { CaimexVoice } from "@caimex/voice/rpc"
import { Button } from "@opencode/ui/button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, onCleanup, Show } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"

// Caimex Desktop: turn-by-turn voice for a session (see packages/caimex-voice). The mic
// stays open while voice is on: a turn ends when the user pauses, is transcribed by the
// gateway, answered by the voice agent, and read back. Talking over a reply cuts it off.
// The gateway key never reaches this page; every call goes through the voice plugin.

type Phase = "off" | "starting" | "listening" | "transcribing" | "thinking" | "speaking"

const SAMPLE_RATE = 16_000
// Loudness (RMS) that counts as speech, how long a pause ends a turn, and bounds.
const SPEECH_LEVEL = 0.018
const BARGE_IN_LEVEL = 0.05
const END_OF_TURN_MS = 900
const MIN_SPEECH_MS = 350
const MAX_TURN_MS = 30_000

function wav(samples: Float32Array, rate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

// RPC failures arrive as plain objects ({ type, message, data }), not Errors.
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === "object") {
    const value = cause as { message?: unknown; data?: { reason?: unknown; message?: unknown } }
    const text = value.data?.reason ?? value.data?.message ?? value.message
    if (typeof text === "string" && text) return text
    return JSON.stringify(cause)
  }
  return String(cause)
}

function base64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const LABELS: Record<Phase, string> = {
  off: "Talk to this session",
  starting: "Starting voice…",
  listening: "Listening",
  transcribing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking",
}

export function VoiceControl(props: { sessionID: string }) {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const rpc = () => sdk.api.rpc(CaimexVoice)
  const options = () => ({ location: { directory: location().directory } })

  const [phase, setPhase] = createSignal<Phase>("off")
  const [error, setError] = createSignal<string>()
  const [heard, setHeard] = createSignal<string>()

  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let player: HTMLAudioElement | undefined
  let stopEvents: (() => void) | undefined
  // The utterance being recorded, and when speech started and was last heard.
  let chunks: Float32Array[] = []
  let speechStart = 0
  let lastSpeech = 0
  let loudSince = 0
  const spoken: string[] = []
  let busy = false

  const level = (samples: Float32Array) => {
    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
    return Math.sqrt(sum / samples.length)
  }

  const stopPlayback = () => {
    player?.pause()
    player = undefined
  }

  // Plays a reply; resolves when it ends or is cut off.
  const play = async (text: string) => {
    if (!text.trim() || phase() === "off") return
    setPhase("speaking")
    const result = await rpc().speak({ text }, options())
    if (phase() !== "speaking") return
    await new Promise<void>((resolve) => {
      const audio = new Audio(`data:${result.mime};base64,${result.audio}`)
      player = audio
      audio.onended = audio.onpause = audio.onerror = () => resolve()
      void audio.play().catch(() => resolve())
    })
    player = undefined
    if (phase() === "speaking") setPhase("listening")
  }

  // Announcements (a task finished, a permission is needed) wait for a quiet moment.
  const drain = async () => {
    if (busy) return
    busy = true
    try {
      while (spoken.length && phase() === "listening" && chunks.length === 0) await play(spoken.shift()!)
    } catch (cause) {
      setError(describe(cause))
      if (phase() === "speaking") setPhase("listening")
    } finally {
      busy = false
    }
  }

  const finishTurn = async () => {
    const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    chunks = []
    busy = true
    try {
      setPhase("transcribing")
      const { text } = await rpc().transcribe({ audio: base64(wav(samples, SAMPLE_RATE)), mime: "audio/wav" }, options())
      if (phase() === "off") return
      if (!text.trim()) return setPhase("listening")
      setHeard(text)
      setPhase("thinking")
      const { reply } = await rpc().turn({ sessionID: props.sessionID, text }, options())
      if (phase() === "off") return
      await play(reply)
    } catch (cause) {
      setError(describe(cause))
      if (phase() !== "off") setPhase("listening")
    } finally {
      busy = false
      void drain()
    }
  }

  const onAudio = (event: AudioProcessingEvent) => {
    const samples = new Float32Array(event.inputBuffer.getChannelData(0))
    const now = performance.now()
    const loud = level(samples)
    // Talking over a reply stops it and starts a new turn.
    if (phase() === "speaking") {
      if (loud > BARGE_IN_LEVEL) {
        loudSince ||= now
        if (now - loudSince > 250) {
          stopPlayback()
          setPhase("listening")
          speechStart = loudSince
          lastSpeech = now
          chunks = [samples]
        }
      } else loudSince = 0
      return
    }
    if (phase() !== "listening") return
    if (loud > SPEECH_LEVEL) {
      if (chunks.length === 0) speechStart = now
      lastSpeech = now
    }
    if (chunks.length === 0 && loud <= SPEECH_LEVEL) return
    chunks.push(samples)
    const long = now - speechStart > MAX_TURN_MS
    if ((now - lastSpeech > END_OF_TURN_MS || long) && lastSpeech - speechStart > MIN_SPEECH_MS) void finishTurn()
    else if (now - lastSpeech > END_OF_TURN_MS) chunks = [] // a short noise, not speech
  }

  const stop = async () => {
    setPhase("off")
    stopPlayback()
    processor?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    await context?.close().catch(() => {})
    stopEvents?.()
    processor = undefined
    stream = undefined
    context = undefined
    stopEvents = undefined
    chunks = []
    spoken.length = 0
    await rpc()
      .stop({ sessionID: props.sessionID }, options())
      .catch(() => {})
  }

  const start = async () => {
    setError(undefined)
    setHeard(undefined)
    setPhase("starting")
    try {
      await rpc().start({ sessionID: props.sessionID }, options())
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      context = new AudioContext({ sampleRate: SAMPLE_RATE })
      const source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(2048, 1, 1)
      processor.onaudioprocess = onAudio
      source.connect(processor)
      // A muted sink keeps the processor running without echoing the mic.
      const sink = context.createGain()
      sink.gain.value = 0
      processor.connect(sink)
      sink.connect(context.destination)
      stopEvents = rpc().events.on("announce", (event) => {
        if (event.data.sessionID !== props.sessionID) return
        spoken.push(event.data.text)
        void drain()
      })
      setPhase("listening")
    } catch (cause) {
      const message = describe(cause)
      await stop()
      setError(/not_signed_in|Sign in/i.test(message) ? "Sign in to Caimex first (Settings → Providers)." : message)
    }
  }

  onCleanup(() => void stop())

  const active = () => phase() !== "off"
  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <Tooltip
        placement="top"
        gutter={4}
        value={error() ?? (heard() ? `${LABELS[phase()]} — you said: “${heard()}”` : LABELS[phase()])}
      >
        <Button
          data-action="caimex-voice"
          variant="ghost-muted"
          size="normal"
          style={{ height: "28px", width: "28px", padding: "0" }}
          classList={{ "text-v2-text-base": active() }}
          aria-label={active() ? "Turn voice off" : "Turn voice on"}
          aria-pressed={active()}
          onClick={() => void (active() ? stop() : start())}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4">
            <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" fill={active() ? "currentColor" : "none"} />
            <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke-linecap="round" />
          </svg>
        </Button>
      </Tooltip>
      <Show when={active() || error()}>
        <span
          classList={{ "text-v2-text-danger": !!error() && !active(), "animate-pulse": phase() === "listening" }}
          class="truncate text-[12px] text-v2-text-muted"
        >
          {error() && !active() ? error() : LABELS[phase()]}
        </span>
      </Show>
    </div>
  )
}
