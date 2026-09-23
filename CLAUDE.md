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
- **`packages/desktop`** — the Electron app, and **`packages/app`** — the
  renderer it (and the web UI) shares. Both are rebranded and wired to the
  gateway; see **The desktop app** below.
- **`packages/cli` + `packages/server` + `packages/protocol`** — the v2 stack.
  `packages/cli` builds the standalone v2 binary the desktop runs as its
  backend; `packages/server` serves the v2 HTTP API over `packages/core`.
- `web`, `console`, `docs`, `storybook` — marketing site / docs. **Not used by
  the CLI or the desktop; do not rebrand these.**

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

A goal of the fork, and it takes **six** independent changes — upstream will
re-open every one of them on a merge, so re-check all six. The first four govern
the v1 CLI; 5 and 6 govern the v2 stack the desktop runs on:

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
5. **v2: no parked "public" key on `opencode`** —
   `packages/core/src/plugin/provider/opencode.ts`. Upstream sets
   `provider.request.body.apiKey = "public"` when unconnected so its free tier
   works without an account. That parked key is also what makes a provider pass
   `Catalog.available()` (`packages/core/src/catalog.ts`), so it listed OpenCode
   Zen in the desktop on a stock install. We leave it unset; the provider then
   stays hidden until someone actually connects it.
6. **v2: the gateway parks one instead** —
   `packages/core/src/plugin/provider/caimex.ts` sets an empty `apiKey` while
   unconnected, for the same `available()` reason but the opposite goal: without
   it Caimex is invisible before login, and invisible means impossible to log
   into, because the connect dialog lists *providers*, not integrations.

Verify with a v2 daemon rather than by reading: `caimex2 service start`, then
`GET /api/provider` should return exactly `["caimex"]` on a clean profile.

⚠️ **Do not "simplify" this by setting `enabled_providers: ["caimex"]` in the
defaults.** That key means "ONLY these providers may load *at all*", so applying
it from a default silently drops providers the user actually asked for — an
`ANTHROPIC_API_KEY` in their environment, or a provider in their own
`caimex.json` — with no error explaining the absence. Restricting the *catalog*
was the goal; restricting what may load was collateral. A user who sets
`enabled_providers` themselves still gets the documented upstream meaning.

Verify with `bun run dev -- models`: every line should start with `caimex/`.

## The desktop app

`packages/desktop` (Electron shell) + `packages/app` (SolidJS renderer, shared
with the web UI). It has **two possible backends**, chosen at startup by
`SIDECAR_VERSION` in `src/main/index.ts`:

- **v2 (this fork's default)** — `startBackgroundCli` in `src/main/background-cli.ts`
  runs a **separate CLI binary** at `resources/opencode-cli` as a background
  daemon (`service start`) and points the renderer at its URL. Upstream defaults
  to v1 and treats v2 as opt-in; we inverted it, and `OPENCODE_SIDECAR_V2=0`
  still selects v1.
- **v1** — `spawnLocalServer` in `src/main/server.ts` forks `src/main/sidecar.ts`
  as an Electron utility process, which imports `packages/opencode/dist/node`.
  That is the same v1 server the CLI runs, so it is caimex-wired already.

⚠️ **The v2 binary must be built from this repo.** Upstream's `predev`/`prebuild`
download it prebuilt from npm (`@opencode-ai/cli-*`), and **that build contains
no Caimex code at all** — a desktop pointed at it can never reach the gateway.
`buildCliToResources()` in `scripts/utils.ts` builds `packages/cli` instead
(`OPENCODE_CLI_BINARY=caimex2`) and stages it under upstream's `opencode-cli`
resource name, skipping the rebuild when the binary is newer than every source
file that goes into it. `downloadCliToResources()` is kept, unused, as the
reference to upstream's path. Cross-target builds are not wired up and throw.

⚠️ **`packages/app` builds against a vendored client, not the workspace one.**
`@opencode-ai/client` resolves to a pinned tarball (`1.17.13-v2`), so the types
the renderer compiles against and the API `packages/server` actually serves can
disagree — and the compiler will not tell you. Everything below was that skew:

- The vendored client declares a **project** API; the v2 server has no project
  group at all (see the group list in `packages/protocol/src/api.ts`). Project
  identity comes from the `location` envelope on every v2 response, or
  `/api/location`.
- It declares an **MCP** group; the v2 server has none.
- It declares `agent.request.settings`; the v2 server sends `request` as
  `{headers, body}`.

The established pattern for these is a `protocol` guard — see `loadPathQuery` in
`packages/app/src/context/global-sync/bootstrap.ts`, which the project and MCP
loaders now follow.

Two gaps in `packages/server` itself, both fixed here and both worth re-checking
after a merge, because a browser-origin renderer cannot work without them:

- **CORS** — the v2 API emitted no CORS headers and 404'd every preflight, so
  the renderer was blocked outright (an authenticated call carries an
  `Authorization` header, which makes it preflighted).
  `src/middleware/cors.ts` adds it, deciding origins with the `isAllowedCorsOrigin`
  that already existed for the PTY handshake.
- **`pid` in `/api/health`** — v1's health payload is `{healthy: true}` too, so
  without a discriminator `detectServerProtocol` in `packages/app` read every v2
  server as v1 and then addressed it on v1 routes, which 404. The protocol now
  declares `pid`, which is what that detector always looked for.
- **Event vocabulary** — the source-built daemon streams `session.next.*`
  events; the renderer (and the vendored client) expect the finalized
  `session.*` names, different payload shapes, and `session.execution.*`
  lifecycle events core never emits. With nothing translating, every event was
  dropped and sessions sat on "Thinking" with the reply already on the server.
  `packages/app/src/utils/server-event-compat.ts` renames, reshapes and
  synthesizes the lifecycle; it becomes a pass-through once core finalizes
  (upstream has it on feature branches, not yet on `dev`). Its test replays a
  captured daemon stream through the real reducer — rerun it after a merge.

`dev`'s v2 session API has 15 endpoints against upstream's finalized 36. Three
are added here, all additive and all worth re-checking after a merge:

- `DELETE /api/session/:id` and `POST /api/session/:id/rename` — same paths and
  names as upstream's, so a merge that brings theirs should conflict loudly
  rather than silently. They reuse the v1 `session.deleted`/`session.updated`
  events, which the projector already applies (Deleted cascades through every
  table keyed on the session); nothing new is written to the event store.
  Rename rebuilds the full row first (`packages/core/src/session/v1-info.ts`)
  because `session.updated` rewrites every column.
- `GET /api/session/:id/legacy-message` — read-only v1 `message`/`part` rows for
  sessions from before the v2 reset (a migration emptied the v2 tables without
  converting them). Upstream has a real converter on its feature branches.

All three skip the session-location middleware, which 500s for a session whose
folder was deleted. Tests: `packages/core/test/session-manage.test.ts`. Fork,
move, shell and inbox are still missing; don't improvise those into the store.

Rebranding touch points beyond the strings: app ids (`zw.co.econetai.caimex.desktop*`
in `electron-builder.config.ts`, kept in step with `scripts/copy-metainfo.ts`),
the `caimex://` URL scheme (`electron-builder.config.ts`, `setAsDefaultProtocolClient`,
and `DEEP_LINK_SCHEME` in `packages/app/src/pages/layout/deep-links.ts`), and the
old app ids retained in `desktopStateNames` so a daemon from a pre-rename install
is adopted rather than duplicated. App icons are ours: one SVG master per channel in
`packages/desktop/icons/master/`, with the derivation in `packages/desktop/icons/README.md`.

## The Caimex Code app (`packages/caimex-code-app`)

A second desktop client, written from scratch in the Claude Code desktop mould (SolidJS
renderer, Electron shell), talking to the same v2 daemon as `packages/desktop` rather
than reusing `packages/app`. It shares the daemon binary staged in
`packages/desktop/resources/caimex-cli`, so build that once first.

- `bun run dev` in the package; dev runs name themselves "Caimex Code Dev" so they never
  contend with an installed build for the single-instance lock. They expose DevTools on
  `localhost:9333` (`CAIMEX_DEBUG_PORT`) for scripted inspection; packaged builds don't.
- `bun run package` builds an unsigned `dist/mac-arm64/Caimex Code.app` with the daemon in
  `Contents/Resources/`. Signing, notarization and a DMG are not wired up.
- **All daemon knowledge lives in `src/renderer/src/api.ts`** (routes, payload shapes, the
  `session.next.*` event names). This app reads the transitional names directly instead of
  translating them like `packages/app` does, so an upstream rename lands in that one file.
- Packaged builds serve the UI from `oc://renderer`, the origin the daemon's CORS
  already allows; `file://` is refused.
- Busy state comes from `GET /api/session/active`, not from open assistant messages: a
  run ends after a denied permission without closing its message.
- Daemon quirks it works around, all worth fixing at the source: a 500 (no CORS headers)
  for sessions whose folder was deleted; model capability flags from the gateway that call
  every model tool-capable, so the picker also filters by name; DeepSeek through the
  gateway emitting identical text on both the reasoning and text channels.
- **Open daemon bug it works around:** the first prompt in a folder the daemon has just
  loaded is admitted and promoted but its run dies before the first step — the provider
  request goes out with an invalid key (HTTP 401 "Invalid API Key", visible only with
  `serve --log-level debug`), the runner logs "Failed to drain Session" and emits no
  `step.failed`, and re-sending the same prompt id doesn't help because the input is
  already promoted. Neither the saved credential nor `CAIMEX_API_KEY` is the bad key, and
  the parked empty key isn't present; ~2s after the folder loads the same prompt works.
  The app lets a new session's folder settle first and flags any prompt with no reply
  after 10s, with a Retry. The real fix is in the daemon (catalog/credential readiness
  for a fresh location).
- Only images are sent as attachments: through the gateway, OpenAI Chat rejects every
  other media type ("does not support media type text/plain"), and the rejected message
  then fails every later turn in that session. Files are referenced by `@path` instead.
- `POST /api/session/:id/compact` answers 503 on `dev` ("not available yet"), so the
  context meter has no Compact action.
- The renderer CSP allows `'wasm-unsafe-eval'` and `data:` in `connect-src` because the
  terminal (ghostty-web) compiles an embedded WebAssembly module.
- **Work tab** (`src/renderer/src/agents.ts`, `hermes.ts`, `components/work.tsx`): Hermes
  agents over Hermes' API server (`/v1/runs`), following the same run protocol as the
  mobile apps (`caimex-mobile/PROTOCOL.md` in the caimex_desktop folder): replay after
  the last `seq`, fall back to polling the run status, one card per approval/question id,
  queue while running, steer. All Hermes traffic goes through the main process
  (`src/main/hermes.ts`) because Hermes only answers allow-listed browser origins; keys
  are stored with `safeStorage` in `userData/agent-keys.json` and never reach the page.
  "Connect this Mac's Hermes" reads `~/.hermes/.env` and `~/.hermes/profiles` there.
  **Scheduled** (`components/scheduled.tsx`) lists Hermes cron jobs (`/api/jobs`) per
  server+profile, with run now / pause / resume / edit / delete. Hermes has no API for
  job results; the main process reads the per-run Markdown files from
  `<hermes home>/cron/output/<job id>/` (or `profiles/<p>/cron/…`), loopback agents only.
- Sessions run by the v1 engine have their history only in the v1 tables; the app reads
  it through `legacy-message` and shows it read-only above any new messages.
- It re-finds the daemon after two failed health checks (`service start` returns the
  current URL), so a daemon restart on a new port doesn't strand it.

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
4. **Re-check all six provider-narrowing points** in *Keeping Caimex the only
   provider* — upstream edits those files, and a merge that silently reverts one
   puts ~91 providers back in the picker.
5. **Re-check the seed model** against `GET /v1/models`.
6. `bun run dev -- models` — every line should start with `caimex/`.
   For the desktop: `cd packages/desktop && bun run dev`, then check the run's
   `main.log` under `~/Library/Application Support/<app id>/logs/` for a v2
   sidecar that came up, and its `renderer.log` for a clean bootstrap. A stale
   instance holds the single-instance lock and makes a new one exit silently
   right after "app starting".
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
