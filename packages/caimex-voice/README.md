# @caimex/voice

Turn-by-turn voice for Caimex Desktop, all through the Caimex gateway.

The app's microphone button (next to the model picker) starts a conversation with a
hidden **voice agent** that drives the session it was started from. Each turn:

1. the app records until you pause, and sends the audio to `transcribe`;
2. the gateway turns it into text (`/v1/audio/transcriptions`);
3. `turn` hands the text to the voice agent, which answers and, when there is work,
   sends a brief to your session with its tools (`voice_send`, `voice_status`,
   `voice_read`, `voice_stop`, `voice_permissions`, `voice_permission_reply`);
4. `speak` reads the answer out (`/v1/audio/speech`). Talking over it stops it.

When work the voice agent sent finishes, or the session needs a permission, the plugin
emits an `announce` event and the app reads it out.

The Caimex key stays in the daemon; the app only sends audio and text.

Options (in the `plugins` entry): `voice` (alloy, ash, coral, echo, fable, nova, onyx,
sage, shimmer), `voiceModel` ("provider/model" for the voice agent), `transcribeModel`
(default `whisper-1`), `speechModel` (default `tts-1`).

The design follows [opencode-gpt-live](https://github.com/malhashemi/opencode-gpt-live)
(© M. Adel Alhashemi, MIT): a voice-agent session with control tools over the main
session, and its voice-agent prompt, adapted. What differs is the audio: GPT-Live holds a
realtime call with OpenAI through a ChatGPT sign-in; this works turn by turn through the
Caimex gateway.
