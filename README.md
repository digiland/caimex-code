# Caimex Code

A CLI coding agent that routes all LLM calls through the **Caimex gateway**.

Caimex Code is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT).
Instead of talking to model providers directly, it points at the Caimex gateway
as a single OpenAI-compatible endpoint, so every request goes through the
gateway's auth, model routing, rate limiting, budget enforcement, and usage
tracking. See [`NOTICE.md`](./NOTICE.md) for attribution — this project is **not
affiliated with or endorsed by the OpenCode team**.

---

## Install

**macOS / Linux (recommended):**

```bash
curl -fsSL https://github.com/digiland/caimex-code/releases/latest/download/install.sh | bash
```

Installs to `~/.local/bin/caimexcode`. Pin a version with
`CAIMEXCODE_CHANNEL=v1.0.0`, change the location with `CAIMEXCODE_INSTALL_DIR`.

**npm (any platform):**

```bash
npm install -g caimexcode
```

**Manual:** grab an archive for your platform from the
[releases page](https://github.com/digiland/caimex-code/releases).

---

## Configure

Caimex Code reads its config from `~/.config/caimex-code/caimex.json`
(`caimex.jsonc`, `opencode.json`, and `config.json` are also accepted). A
starter config ships in this repo at [`caimex.json`](./caimex.json) — copy it
and point `baseURL` at your Caimex gateway:

```bash
mkdir -p ~/.config/caimex-code
cp caimex.json ~/.config/caimex-code/caimex.json
# edit ~/.config/caimex-code/caimex.json → set the caimex provider baseURL to
# your gateway's /v1 endpoint
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
        "baseURL": "http://localhost:8240/v1" // ← your gateway
      }
    }
  },
  "model": "caimex/Caimex/moonshotai/kimi-k2.6"
}
```

- Models are **auto-discovered** from the gateway's `GET /v1/models`; you may
  still declare models under `"models"` to override names/limits/cost.
- Reference a model as `caimex/<model-id>` (ids match the gateway's `/v1/models`).
- The API key is supplied by `caimexcode auth login` (no `apiKey` needed in
  config; a `CAIMEX_API_KEY` env var works as a fallback).

## Log in

```bash
caimexcode auth login          # pick the "caimex" provider
```

Choose **"Login with Caimex (opens browser)"** — the CLI prints a short code and
opens your gateway's login page; approve it there and the CLI receives a key.
(Or choose **"Paste a Caimex API key"** if you already have one.)

## Usage

```bash
caimexcode                          # interactive TUI
caimexcode models                   # list available models
caimexcode run "Explain this repo"  # non-interactive, prints answer
caimexcode upgrade                  # self-update from GitHub Releases
caimexcode --help                   # all commands
```

---

## Development

This is a Bun/TypeScript monorepo.

```bash
curl -fsSL https://bun.sh/install | bash    # if you don't have bun
bun install
bun run dev                                 # run the TUI from source
bun run dev -- run "hello"                  # any CLI command from source
```

### Build standalone binaries

```bash
./build-caimexcode.sh --single     # current platform only
./build-caimexcode.sh              # all platforms (linux/darwin/windows, x64/arm64)
```

Archives land in `packages/caimexcode/` as `caimexcode-<os>-<arch>.{tar.gz,zip}`
with SHA256 checksums.

### Release

Push a tag and CI does the rest — builds all targets, creates the GitHub
Release with archives + `install.sh`, and publishes `caimexcode` to npm (when
the `NPM_TOKEN` secret is configured):

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Upstream's original README is preserved in git history and in the translated
`README.*.md` files. Upstream OpenCode workflows are parked in
`.github/workflows-upstream/`.

## License

MIT — original code Copyright (c) 2025 opencode; modifications Copyright (c)
2026 Caimex. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).
