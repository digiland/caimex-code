# Caimex Code

A CLI coding agent that routes all LLM calls through the **Caimex gateway**.

Caimex Code is an internal fork of [OpenCode](https://github.com/anomalyco/opencode)
(MIT). Instead of talking to model providers directly, it points at the Caimex
gateway as a single OpenAI-compatible endpoint, so every request goes through the
gateway's auth, model routing, rate limiting, budget enforcement, and usage
tracking. See [`NOTICE.md`](./NOTICE.md) for attribution — this project is **not
affiliated with or endorsed by the OpenCode team**.

> Upstream's original README is preserved in git history and in the translated
> `README.*.md` files.

---

## Prerequisites

1. **Corporate VPN.** Everything lives on the internal network — connect to the
   VPN (Cisco AnyConnect) before anything below.
2. **Bun** (the runtime — this is a Bun/TypeScript monorepo):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   export PATH="$HOME/.bun/bin:$PATH"   # add to ~/.zshrc to persist
   ```
3. **The Caimex gateway reachable.** The deployed gateway is at
   `http://192.168.127.203:8002` (OpenAI-compatible under `/v1`). Check it:
   ```bash
   curl -s http://192.168.127.203:8002/health      # -> {"status":"ok",...}
   curl -s http://192.168.127.203:8002/v1/models   # -> {"data":[ ...models... ]}
   ```
   > `http://localhost:8240` is only for local gateway development — use the
   > `192.168.127.203:8002` address for testing.

You do **not** need to create an API key by hand — you log in from the CLI
(below), which fetches a gateway key for you.

---

## Install

```bash
git clone http://gitlab-svr-1/artificial-intelligence/caimex-code.git caimex-code
cd caimex-code
git checkout caimex                         # the fork mainline
export PATH="$HOME/.bun/bin:$PATH"          # bun MUST be on PATH or native
bun install                                 # build scripts fail with code 127
```

---

## Configure

Caimex Code reads its config from `~/.config/caimex-code/caimex.json`
(`caimex.jsonc`, `opencode.json`, and `config.json` are also accepted). A
gateway-pointed config ships in this repo at [`caimex.json`](./caimex.json) —
copy it to the global location and point `baseURL` at the deployed gateway:

```bash
mkdir -p ~/.config/caimex-code
cp caimex.json ~/.config/caimex-code/caimex.json
# edit ~/.config/caimex-code/caimex.json → set the caimex provider baseURL to:
#   "baseURL": "http://192.168.127.203:8002/v1"
```

The config defines a custom OpenAI-compatible provider named `caimex`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "caimex": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Caimex Gateway",
      "options": {
        "baseURL": "http://192.168.127.203:8002/v1"
      }
    }
  },
  "model": "caimex/Caimex/moonshotai/kimi-k2.6"
}
```

- You no longer need to hand-list models — Caimex Code **auto-discovers** them
  from the gateway's `GET /v1/models` (see [Model auto-discovery](#model-auto-discovery)).
  You may still declare models under `"models"` to override names/limits/cost.
- Reference a model as `caimex/<model-id>` (ids match the gateway's `/v1/models`).
- Point `baseURL` at whichever gateway you're testing against.
- The API key is supplied by `caimex auth login` below (no `apiKey` needed in
  config; a `CAIMEX_API_KEY` env var still works as a fallback).

---

## Log in

Authenticate the CLI to the gateway once — this stores a gateway key locally so
you don't manage API keys by hand:

```bash
bun run dev -- auth login          # pick the "caimex" provider
```

Choose **"Login with Caimex (opens browser)"** — the CLI prints a short code and
opens the login page (`http://192.168.127.203:4200`); approve it there and the
CLI receives a key. (Or choose **"Paste a Caimex API key"** if you already have
one.)

---

## Usage

From the repo (dev mode, runs from source):

```bash
export PATH="$HOME/.bun/bin:$PATH"

bun run dev                                   # interactive TUI
bun run dev -- models                         # list available models
bun run dev -- run "Explain this repo"        # non-interactive, prints answer
bun run dev -- run "Fix the failing test" --model caimex/Qwen3.5-122b
bun run dev -- --help                         # all commands
```

Once you build a standalone binary (below), the command is just `caimex`:

```bash
caimex                          # TUI
caimex run "..."                # non-interactive
caimex models
```

---

## Build a standalone binary

```bash
cd packages/opencode
bun run build --single          # current platform only; output in ./dist
```

Then symlink/copy the produced `caimex` binary onto your `PATH`.

---

## Model auto-discovery

Caimex Code reads the gateway's `GET /v1/models` and **registers every model it
returns** — including pricing and modalities (text/image/pdf/…). Add a model to
the gateway and it shows up in the CLI with no config change.

- Models you explicitly list under `provider.caimex.models` in `caimex.json` are
  preserved as-is (only their live pricing is refreshed); discovery only *adds*
  models you haven't declared.
- The catalog is cached at `~/.cache/caimex-code/model-catalog.json` and
  refreshed in the background (the endpoint is slow, so startup never blocks).
  The long-running **TUI** warms this cache; the first run may not show
  discovered models until the cache is populated, after which `models` / `run`
  see them too.

Environment toggles:

| Variable | Effect |
| --- | --- |
| `CAIMEX_GATEWAY_URL` | Gateway base (default `http://localhost:8240`); used to derive login + fallback model endpoints. Set to `http://192.168.127.203:8002` for the deployed gateway. |
| `CAIMEX_DISABLE_MODEL_DISCOVERY=1` | Keep pricing, but don't auto-register models — pin the list to `caimex.json`. |
| `CAIMEX_DISCOVERY_DEFAULT_CONTEXT` | Context window for a discovered model when the gateway doesn't advertise one (default `128000`). |
| `CAIMEX_DISCOVERY_DEFAULT_OUTPUT` | Max output tokens fallback (default `32000`). |

---

## Updating

> **Auto-update is not wired to GitLab yet.** The upstream OpenCode updater
> (`caimex upgrade`) points at OpenCode's public infrastructure and will not work
> against our internal GitLab. Until the GitLab release pipeline is in place,
> update manually:

```bash
cd caimex-code
git pull origin caimex          # get the latest fork changes
bun install
# re-run from source (bun run dev) or rebuild the binary (see above)
```

---

## Updating from upstream OpenCode

This fork keeps an `upstream` remote so you can pull improvements:

```bash
git fetch upstream
git merge upstream/dev          # resolve conflicts in rebranded files
```

Rebranding was kept intentionally small (see [`CLAUDE.md`](./CLAUDE.md)) to make
these merges easy.

---

## What's different from OpenCode

| Area | OpenCode | Caimex Code |
| --- | --- | --- |
| LLM endpoint | provider-direct | Caimex gateway (`/v1`, OpenAI-compatible) |
| Command / binary | `opencode` | `caimex` |
| App id / config dir | `~/.config/opencode` | `~/.config/caimex-code` |
| Config filenames | `opencode.json*` | `caimex.json*` (opencode names still accepted) |
| Auth | provider API keys | `caimex auth login` (device login) or `CAIMEX_API_KEY` |
| Models | hand-listed in config | auto-discovered from the gateway's `/v1/models` |

The VS Code extension (`sdks/vscode`) is **not** rebranded yet.

---

## License

MIT — see [`LICENSE`](./LICENSE) (retained from upstream OpenCode) and
[`NOTICE.md`](./NOTICE.md).
