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

Installs to `~/.local/bin/caimex`. Pin a version with
`CAIMEXCODE_CHANNEL=v1.0.0`, change the location with `CAIMEXCODE_INSTALL_DIR`.

**npm (any platform):**

```bash
npm install -g caimex
```

**Manual:** grab an archive for your platform from the
[releases page](https://github.com/digiland/caimex-code/releases).

---

## Configure

**Nothing to configure by default.** Caimex Code ships pointing at the Caimex
gateway out of the box:

| | |
|---|---|
| Login (device auth) | `https://incmanagement.econet.co.zw:9050` |
| API (`/v1`)         | `https://incmanagement.econet.co.zw:9051/v1` |

Override either without touching a config file:

```bash
export CAIMEX_GATEWAY_URL=http://localhost:8240        # login / device-auth host
export CAIMEX_API_BASE_URL=http://localhost:8240/v1    # OpenAI-compatible API
```

For anything else, drop a config at `~/.config/caimex-code/caimex.json`
(`caimex.jsonc`, `opencode.json`, and `config.json` are also accepted). It
merges *over* the built-in defaults, so you only specify what differs. A full
starter config ships in this repo at [`caimex.json`](./caimex.json):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "caimex": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Caimex Gateway",
      "options": {
        "baseURL": "https://incmanagement.econet.co.zw:9051/v1" // ← your gateway
      }
    }
  },
  "model": "caimex/Caimex/moonshotai/kimi-k2.6"
}
```

- Models are **auto-discovered** from the gateway's `GET /v1/models`; you may
  still declare models under `"models"` to override names/limits/cost.
- Reference a model as `caimex/<model-id>` (ids match the gateway's `/v1/models`).
- The API key is supplied by `caimex auth login` (no `apiKey` needed in
  config; a `CAIMEX_API_KEY` env var works as a fallback).

## Log in

```bash
caimex auth login          # pick the "caimex" provider
```

Choose **"Login with Caimex (opens browser)"** — the CLI prints a short code and
opens your gateway's login page; approve it there and the CLI receives a key.
(Or choose **"Paste a Caimex API key"** if you already have one.)

### Troubleshooting: `unable to verify the first certificate`

The gateway is currently serving only its leaf certificate, without the
`DigiCert Global G2 TLS RSA SHA256 2020 CA1` intermediate. `curl` hides this
(macOS completes the chain from its own store) but Bun/Node cannot, so requests
fail with `unable to verify the first certificate`.

The fix belongs on the server — point nginx's `ssl_certificate` at the
**fullchain** PEM (leaf + intermediate) rather than the leaf alone. Until then,
trust the intermediate locally:

```bash
curl -fsSL http://cacerts.digicert.com/DigiCertGlobalG2TLSRSASHA2562020CA1-1.crt -o /tmp/digicert-g2.crt
openssl x509 -inform DER -in /tmp/digicert-g2.crt -out ~/.config/caimex-code/gateway-ca.pem
export NODE_EXTRA_CA_CERTS=~/.config/caimex-code/gateway-ca.pem   # add to your shell profile
```

## Usage

```bash
caimex                          # interactive TUI
caimex models                   # list available models
caimex run "Explain this repo"  # non-interactive, prints answer
caimex upgrade                  # self-update from GitHub Releases
caimex --help                   # all commands
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
./build-caimex.sh --single     # current platform only
./build-caimex.sh              # all platforms (linux/darwin/windows, x64/arm64)
```

Archives land in `packages/caimex/` as `caimex-<os>-<arch>.{tar.gz,zip}`
with SHA256 checksums.

### Release

Push a tag and CI does the rest — builds all targets, creates the GitHub
Release with archives + `install.sh`, and publishes `caimex` to npm (when
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
