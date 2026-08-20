# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

**Caimex Code** — a Bun/TypeScript fork of [OpenCode](https://github.com/anomalyco/opencode)
(MIT) that routes all LLM traffic through the **Caimex gateway** (an
OpenAI-compatible endpoint, default `https://caimex.econetai.co.zw:2052/v1`)
instead of calling providers directly. It is a rebranded build published as the
npm package `caimex`; not affiliated with the OpenCode team (see `NOTICE.md`).
End-user docs are in `README.md`.

This is a fork: keep an eye on `AGENTS.md` too (upstream's agent notes — e.g.
upstream's default branch is `dev`, short hyphenated branch names, no `feat/`
prefixes). Our working branch is `caimex`; see **Pulling from upstream** below.

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

# Standalone binary (upstream's build, named `opencode`)
cd packages/opencode && bun run build --single

# Release archives (`caimex-<os>-<arch>.{tar.gz,zip}` + SHA256SUMS in packages/caimex/)
cd packages/opencode && bun run build-caimex --single   # drop --single to build every target
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

## Gateway integration

The gateway provider is **baked into the defaults in code**, not only in config.
`caimexDefaults()` in `packages/opencode/src/config/config.ts` registers the
`caimex` provider (`npm: @ai-sdk/openai-compatible`) with its `baseURL` and one
seed model, so a stock install works before any config file exists. Every config
file merges *over* those defaults, so a user can still override or add.

- **Base URL** — `CAIMEX_DEFAULT_API_BASE_URL` in that file, overridable at
  runtime with `CAIMEX_API_BASE_URL`. The device-auth endpoints derive from
  `CAIMEX_GATEWAY_URL` (see the caimex plugin).
- **Models are auto-discovered** from the gateway's `GET /v1/models`; the config
  declares no `models` map. Reference them as `caimex/<model-id>`.
- **The seed model must exist on the gateway.** It is the only selectable model
  before the catalog is cached, so a wrong id is a phantom the picker offers and
  the request path then rejects. Check it against `GET /v1/models` — that has
  been wrong twice.
- **Auth is `caimex auth login`** (device flow, browser). `CAIMEX_API_KEY` still
  works as a fallback. There is no `auth.ts` — `caimex providers` carries the
  `auth` alias.
- The repo ships a starter `caimex.json` at the root for
  `~/.config/caimex-code/caimex.json`.

## Keeping Caimex the only provider

A goal of the fork, and it takes **four** independent changes — upstream will
re-open every one of them on a merge, so re-check all four:

1. **Catalog narrowing** — `CAIMEX_CATALOG_PROVIDERS` (`config/config.ts`),
   applied in `cli/cmd/providers.ts` (connect dialog) and
   `server/routes/instance/httpapi/handlers/provider.ts` (listing API). Without
   it, models.dev's ~91 providers show up on a stock install.
2. **`packages/opencode/src/provider/provider.ts`** — drops the whole `opencode`
   provider unless it is explicitly configured. Upstream keeps its zero-cost
   models loadable without a key.
3. **`packages/core/src/plugin/provider/opencode.ts`** — the V2 equivalent:
   disables all opencode models rather than only the paid ones.
4. **The default provider set itself** — `caimexDefaults()`.

⚠️ **Do not "simplify" this by setting `enabled_providers: ["caimex"]` in the
defaults.** That key means "ONLY these providers may load *at all*", so applying
it from a default silently drops providers the user actually asked for — an
`ANTHROPIC_API_KEY` in their environment, or a provider in their own
`caimex.json` — with no error explaining the absence. Restricting the *catalog*
was the goal; restricting what may load was collateral. A user who sets
`enabled_providers` themselves still gets the documented upstream meaning.

Verify with `bun run dev -- models`: every line should start with `caimex/`.

## Rebranding conventions

Keep the rebrand **minimal and upstream-mergeable** — we pull from `upstream`
(anomalyco/opencode) over time. Do **not** mass-replace every `opencode` string
across the tree (hundreds, mostly in web/docs/desktop). Prefer a few high-signal
changes that survive merges.

The intentional touch points, grouped by what they do:

**Identity**
- `packages/core/src/global.ts` — app id `caimex-code` → `~/.config/caimex-code/`
- `packages/opencode/src/index.ts` — `scriptName("caimex")`, command registration
- `packages/opencode/package.json` — bin key `caimex` (the package itself stays
  named `opencode` and `private` — see **Distribution**)
- `packages/tui/src/attention.ts` — default title `caimex`
- `packages/opencode/src/config/config.ts` — `caimex.json*` config names
- Various `packages/tui/src/**` and `packages/opencode/src/cli/**` user-facing
  strings, plus `src/session/prompt/*.txt`

**Gateway + provider** — see the two sections above
- `packages/opencode/src/plugin/caimex.ts` (v1) and
  `packages/core/src/plugin/provider/caimex.ts` (v2) — device auth + model
  discovery. **Two implementations of the same thing; keep them in step.**
  Registered in `packages/opencode/src/plugin/index.ts` and
  `packages/core/src/plugin/provider.ts` respectively.
- `packages/opencode/src/provider/error.ts` — reads FastAPI's `detail` field, so
  gateway refusals (free-tier 402s, per-model 403s) read as sentences rather
  than JSON dumps

**Distribution**
- `packages/opencode/src/installation/index.ts` — `CAIMEX_NPM_PACKAGE`,
  `CAIMEX_GITHUB_REPO`; drives `caimex upgrade`
- `packages/opencode/script/build-caimex.ts`, `build-caimex.sh`, `install.sh`
- `npm/caimex/` — the published npm package (manifest, `install.mjs` postinstall,
  placeholder binary)
- `.github/workflows/release-caimex.yml` — ours. Upstream's workflows are parked
  in `.github/workflows-upstream/` and **must not run here**; they assume
  upstream's secrets, bots and npm packages.

## Pulling from upstream

`upstream` = `github.com/anomalyco/opencode`, `origin` = `github.com/digiland/caimex-code`.
Our work lives on the **`caimex`** branch. The `develop`, `dev` and
`gitlab-release` branches are historical — `dev` is over a thousand commits
behind and `gitlab-release` targets an abandoned on-prem GitLab plan.

```bash
git fetch upstream
git merge upstream/dev          # onto caimex; conflicts are mostly rebranded strings
```

After **every** merge, before tagging a release:

1. `bun install` — upstream moves dependency versions often.
2. `bun run typecheck && bun run lint` — both must be clean (lint has ~4.9k
   pre-existing warnings; only the error count matters).
3. `cd packages/opencode && bun test` — a handful of failures are pre-existing
   and environmental (`snapshot-tool-race` is an upstream known-bug reproducer;
   the `httpapi-*` suites time out under load). Confirm a failure is
   pre-existing by stashing your change and re-running before chasing it.
4. **Re-check all four provider-narrowing points** in *Keeping Caimex the only
   provider* — upstream edits those files, and a merge that silently reverts one
   puts ~91 providers back in the picker.
5. **Re-check the seed model** against `GET /v1/models`.
6. `bun run dev -- models` — every line should start with `caimex/`.
7. `bun run dev -- auth login` reaches the gateway's device flow, and
   `bun run dev -- --help` still says `caimex`.
8. Rebrand any new user-facing strings and locale files upstream added.

## Distribution

Published as the npm package **`caimex`** plus **GitHub Releases**, both from one
tag. `packages/opencode/package.json` is `private` and still named `opencode` —
it is never published. The npm package is a **separate, hand-maintained manifest
at `npm/caimex/`**; the workflow only stamps its version (`npm pkg set version`,
its committed value stays `0.0.0`).

- **Trigger:** push a tag `vX.Y.Z` → `.github/workflows/release-caimex.yml`
  builds every target, creates the GitHub Release (archives + `SHA256SUMS` +
  `install.sh`), then publishes `npm/caimex/` with provenance.
- **No `NPM_TOKEN`.** Publishing uses npm **trusted publishing** over OIDC,
  configured on npmjs.com against `digiland/caimex-code` + `release-caimex.yml`.
  The workflow's own header comment still says "when an NPM_TOKEN secret is
  configured" — that is stale; the job uses no token.
- **The npm package ships no binary.** It carries a placeholder at
  `bin/caimex.exe` and an `install.mjs` postinstall that downloads
  `caimex-<target>.<ext>` from the **GitHub Release of the same version** and
  verifies it against that release's `SHA256SUMS`. So an npm publish without its
  matching release assets installs a broken binary — the two must ship together.
- `bin/caimex.exe` on macOS and Linux is deliberate, not a bug: Windows needs the
  suffix and Unix does not care about the name, so one bin entry serves all.
- Archive naming is duplicated in three places that must agree —
  `build-caimex.ts`, `install.sh`, and `npm/caimex/install.mjs`.

## Licensing

MIT. Keep `LICENSE` intact (required) and `NOTICE.md` (attribution). Don't
present the project as OpenCode or imply official affiliation.
