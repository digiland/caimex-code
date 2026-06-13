# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

**Caimex Code** — a Bun/TypeScript fork of [OpenCode](https://github.com/anomalyco/opencode)
(MIT) that routes all LLM traffic through the **Caimex gateway** (an
OpenAI-compatible endpoint, default `http://localhost:8240/v1`) instead of
calling providers directly. It is an internal, rebranded build; not affiliated
with the OpenCode team (see `NOTICE.md`). End-user docs are in `README.md`.

This is a fork: keep an eye on `AGENTS.md` too (upstream's agent notes — e.g.
default branch is `dev`, short hyphenated branch names, no `feat/` prefixes).

## Runtime requires Bun

Everything runs on **Bun** (not Node). Bun must be on `PATH` or native install
scripts fail with exit 127:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install
```

## Common commands

```bash
# Run the CLI from source (this is the runnable entry point)
bun run dev                      # interactive TUI
bun run dev -- run "<prompt>"    # non-interactive (use this to verify behavior;
                                 #   the TUI can't be driven headless)
bun run dev -- models            # list models from the configured provider(s)
bun run dev -- --help

# Quality
bun run lint                     # oxlint (root)
bun run typecheck                # bun turbo typecheck (root)

# Tests — per package, NOT from root (root `test` intentionally errors)
cd packages/opencode && bun test
cd packages/opencode && bun run typecheck   # tsgo --noEmit

# Standalone binary
cd packages/opencode && bun run build --single
```

## Architecture (monorepo, ~26 packages under `packages/`)

The ones that matter for this fork:

- **`packages/opencode`** — the runnable CLI + TUI host. Entry: `src/index.ts`
  (`scriptName("caimex")`). **This is the runtime**; its behavior is what users
  experience.
- **`packages/core`** — shared core (global paths, model catalog, a V2 config
  system, plugins). `src/global.ts` defines the app id (`caimex-code`) → config
  dir `~/.config/caimex-code/`.
- **`packages/llm`** — provider abstraction over the Vercel AI SDK, including
  first-class custom OpenAI-compatible provider support.
- **`packages/tui`** — terminal UI.
- **`sdks/vscode`** — VS Code extension. **Not rebranded yet** — leave it unless
  explicitly asked.
- `web`, `app`, `desktop`, `console`, `docs`, `storybook` — marketing site /
  desktop app / web UI. **Not used by the CLI; do not rebrand these.**

## ⚠️ Critical gotcha: there are TWO config systems

The running CLI (`packages/opencode/src/config/config.ts`) has **its own** config
loader, separate from `packages/core`'s V2 config (`packages/core/src/config.ts`).
**Editing the core V2 config does NOT affect the running app.** When changing
config behavior (filenames, search paths, schema), edit
`packages/opencode/src/config/config.ts`. Global config filenames are hardcoded
there — Caimex names (`caimex.json`, `caimex.jsonc`) were added alongside the
`opencode.*` / `config.json` defaults.

## Gateway integration is config-only

Pointing Caimex Code at a gateway needs **no code change** — it's the custom
provider in `~/.config/caimex-code/caimex.json` (`npm: @ai-sdk/openai-compatible`,
`options.baseURL`, `options.apiKey: {env:CAIMEX_API_KEY}`). The repo ships a
default `caimex.json`. Model ids must match the gateway's `GET /v1/models`;
reference models as `caimex/<model-id>`. Live runs need the gateway up on `:8240`
and `CAIMEX_API_KEY` set.

## Rebranding conventions

Keep the rebrand **minimal and upstream-mergeable** — we pull from `upstream`
(anomalyco/opencode) over time. The intentional touch points so far:

- `packages/core/src/global.ts` — app id `caimex-code`
- `packages/opencode/src/index.ts` — `scriptName("caimex")`
- `packages/opencode/package.json` — bin key `caimex`
- `packages/tui/src/attention.ts` — default title `caimex`
- `packages/opencode/src/config/config.ts` — `caimex.json*` config names

Do **not** mass-replace every `opencode` string across the tree (hundreds, mostly
in web/docs/desktop). Prefer a few high-signal changes that survive merges.

## Licensing

MIT. Keep `LICENSE` intact (required) and `NOTICE.md` (attribution). Don't
present the project as OpenCode or imply official affiliation.
