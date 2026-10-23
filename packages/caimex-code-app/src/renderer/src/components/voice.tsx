import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { Api, DaemonEvent } from "../api"

// Turn-by-turn voice for a session, through the daemon's caimex-voice plugin (the same
// one Caimex Desktop uses). The mic stays open while voice is on: a turn ends when you
// pause, the Caimex gateway transcribes it, the voice agent answers, and the gateway
// reads the answer out. Talking over a reply cuts it off. The gateway key never
// reaches this page — every call goes through the plugin, which holds the sign-in.

const RPC = "caimexvoice"

type Phase = "off" | "starting" | "listening" | "transcribing" | "thinking" | "speaking"

const SAMPLE_RATE = 16_000
// Loudness (RMS) that counts as speech, how long a pause ends a turn, and bounds.
const SPEECH_LEVEL = 0.018
const BARGE_IN_LEVEL = 0.05
const END_OF_TURN_MS = 900
const MIN_SPEECH_MS = 350
const MAX_TURN_MS = 30_000

const LABELS: Record<Phase, string> = {
  off: "Talk to this session",
  starting: "Starting voice…",
  listening: "Listening",
  transcribing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking",
}

// The plugin pushes things to say unprompted (a task finished, a permission is
// needed) as `rpc.caimexvoice.announce` on the daemon's event stream. The app owns
// that stream, so it hands those events here.
const listeners = new Set<(event: DaemonEvent) => void>()
export function dispatchVoiceEvent(event: DaemonEvent) {
  if (event.type.startsWith(`rpc.${RPC}.`)) for (const listener of listeners) listener(event)
}

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

function base64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function audioURL(data: string, mime: string) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

// The plugin relays the gateway's words ("The gateway answered 403: Model 'whisper-1'
// is not enabled for CAIMEx Code…"). The status prefix is noise to a person; the rest
// already says what to do.
function describe(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^The gateway answered \d+:\s*/, "")
}

// A model the gateway won't serve fails every turn the same way, so there is no point
// keeping the mic open: voice switches off and says why.
const unrecoverable = (message: string) => /not enabled|sign in/i.test(message)

export function VoiceControl(props: { api: Api; sessionID: string; directory: string }) {
  const call = <T,>(method: string, input: unknown) => props.api.rpc<T>(RPC, method, input, props.directory)

  const [phase, setPhase] = createSignal<Phase>("off")
  const [error, setError] = createSignal<string>()
  const [heard, setHeard] = createSignal<string>()

  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let player: HTMLAudioElement | undefined
  let unlisten: (() => void) | undefined
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

  const fail = (cause: unknown) => {
    const message = describe(cause)
    setError(message)
    if (unrecoverable(message)) void stop(message)
    else if (phase() !== "off") setPhase("listening")
  }

  // Plays a reply; resolves when it ends or is cut off.
  const play = async (text: string) => {
    if (!text.trim() || phase() === "off") return
    setPhase("speaking")
    const result = await call<{ audio: string; mime: string }>("speak", { text })
    if (phase() !== "speaking") return
    const url = audioURL(result.audio, result.mime)
    await new Promise<void>((resolve) => {
      const audio = new Audio(url)
      player = audio
      audio.onended = audio.onpause = audio.onerror = () => resolve()
      void audio.play().catch(() => resolve())
    })
    URL.revokeObjectURL(url)
    player = undefined
    if (phase() === "speaking") setPhase("listening")
  }

  // Announcements wait for a quiet moment rather than talking over you.
  const drain = async () => {
    if (busy) return
    busy = true
    try {
      while (spoken.length && phase() === "listening" && chunks.length === 0) await play(spoken.shift()!)
    } catch (cause) {
      fail(cause)
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
      const { text } = await call<{ text: string }>("transcribe", {
        audio: base64(wav(samples, SAMPLE_RATE)),
        mime: "audio/wav",
      })
      if (phase() === "off") return
      if (!text.trim()) return setPhase("listening")
      setHeard(text)
      setError(undefined)
      setPhase("thinking")
      const { reply } = await call<{ reply: string }>("turn", { sessionID: props.sessionID, text })
      if (phase() === "off") return
      await play(reply)
    } catch (cause) {
      fail(cause)
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

  async function stop(reason?: string) {
    setPhase("off")
    stopPlayback()
    processor?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    await context?.close().catch(() => {})
    unlisten?.()
    processor = undefined
    stream = undefined
    context = undefined
    unlisten = undefined
    chunks = []
    spoken.length = 0
    if (reason) setError(reason)
    await call("stop", { sessionID: props.sessionID }).catch(() => {})
  }

  const start = async () => {
    setError(undefined)
    setHeard(undefined)
    setPhase("starting")
    try {
      const { signedIn } = await call<{ signedIn: boolean }>("start", { sessionID: props.sessionID })
      if (!signedIn) throw new Error("Sign in to Caimex first, in Settings.")
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
      const listener = (event: DaemonEvent) => {
        if (!event.type.endsWith(".announce") || event.data.sessionID !== props.sessionID) return
        spoken.push(String((event.data as { text?: unknown }).text ?? ""))
        void drain()
      }
      listeners.add(listener)
      unlisten = () => listeners.delete(listener)
      setPhase("listening")
    } catch (cause) {
      const message =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access is off for Caimex Code. Turn it on in System Settings → Privacy & Security → Microphone."
          : describe(cause)
      await stop(message)
    }
  }

  // The Code and Work tabs stay mounted and are only hidden, so switching tabs doesn't
  // unmount this. A microphone left listening behind a tab you can't see is the one
  // thing voice must never do — so it switches off as soon as the control is hidden.
  let control!: HTMLButtonElement
  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && phase() !== "off") void stop()
    })
    observer.observe(control)
    onCleanup(() => observer.disconnect())
  })

  onCleanup(() => {
    if (phase() !== "off") void stop()
  })

  const active = () => phase() !== "off"
  const tooltip = () => error() ?? (heard() ? `${LABELS[phase()]} — you said “${heard()}”` : LABELS[phase()])

  return (
    <div class="flex min-w-0 shrink-0 items-center gap-1.5">
      <Show when={active() || error()}>
        <span
          classList={{ "text-bad": !!error(), "text-muted": !error(), "animate-pulse": phase() === "listening" && !error() }}
          class="max-w-[220px] truncate text-[12px]"
          title={tooltip()}
        >
          {error() ?? LABELS[phase()]}
        </span>
      </Show>
      <button
        ref={control}
        title={tooltip()}
        aria-label={active() ? "Turn voice off" : "Turn voice on"}
        aria-pressed={active()}
        onClick={() => void (active() ? stop() : start())}
        classList={{ "bg-active text-text": active(), "text-muted": !active() }}
        class="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-text"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" fill={active() ? "currentColor" : "none"} />
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  )
}
