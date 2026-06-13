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

1. **Bun** (the runtime — this is a Bun/TypeScript monorepo):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   export PATH="$HOME/.bun/bin:$PATH"   # add to ~/.zshrc to persist
   ```
2. **The Caimex gateway running** (default `http://localhost:8240`). Check it:
   ```bash
   curl -s http://localhost:8240/health   # -> {"status":"ok",...}
   ```
3. **A gateway API key** (`sk-or-...`) — create one in the Caimex UI under
   `/api-keys`.

---

## Install

```bash
git clone <your-private-repo> caimex-code   # or use this checkout
cd caimex-code
export PATH="$HOME/.bun/bin:$PATH"          # bun MUST be on PATH or native
bun install                                 # build scripts fail with code 127
```

---

## Configure

Caimex Code reads its config from `~/.config/caimex-code/caimex.json`
(`caimex.jsonc`, `opencode.json`, and `config.json` are also accepted). A
gateway-pointed config ships in this repo at [`caimex.json`](./caimex.json) —
copy it to the global location:

```bash
mkdir -p ~/.config/caimex-code
cp caimex.json ~/.config/caimex-code/caimex.json
export CAIMEX_API_KEY="sk-or-v1-..."        # add to ~/.zshrc to persist
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
        "baseURL": "http://localhost:8240/v1",
        "apiKey": "{env:CAIMEX_API_KEY}"
      },
      "models": {
        "Caimex/moonshotai/kimi-k2.6": { "name": "Kimi K2.6" },
        "Qwen3.5-122b": { "name": "Qwen 3.5 122B" }
      }
    }
  },
  "model": "caimex/Caimex/moonshotai/kimi-k2.6"
}
```

- **Model ids** under `models` must match what `GET /v1/models` returns from your
  gateway. Reference a model as `caimex/<model-id>`.
- Point `baseURL` at your deployed gateway if it isn't local.
- Add or remove models to match your gateway catalog.

---

## Usage

From the repo (dev mode, runs from source):

```bash
export PATH="$HOME/.bun/bin:$PATH"
export CAIMEX_API_KEY="sk-or-v1-..."

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
| Auth | provider API keys | `CAIMEX_API_KEY` (gateway key) |

The VS Code extension (`sdks/vscode`) is **not** rebranded yet.

---

## License

MIT — see [`LICENSE`](./LICENSE) (retained from upstream OpenCode) and
[`NOTICE.md`](./NOTICE.md).
