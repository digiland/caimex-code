# Caimex Code 2.x: the fork

This branch (`caimex-v2`) is OpenCode's 2.x line (`upstream/v2`) with the Caimex gateway
as its provider. It builds both the `caimex` CLI and Caimex Desktop, which share one app
id, `caimex`: one config (`~/.config/caimex`), one sign-in, one session store and one
background service. The 1.x CLI lives on the `caimex` branch.

Changes are kept few and marked `// Caimex:` (older ones `// Caimex Desktop:`) so
upstream merges stay easy.

## Our changes, by file

**Provider**
- `packages/core/src/plugin/provider/caimex.ts` (+ registration in `provider.ts`): the
  gateway provider: device sign-in, key and env methods, model discovery. It is
  activated without a connection, so Caimex is listed (and can be signed in to) first.
- `packages/core/src/plugin/provider/opencode.ts`: OpenCode Zen's free tier stays hidden
  (no parked "public" key, every opencode model disabled without one).

**Identity**
- `packages/util/src/global.ts`: app id `caimex`. `packages/client/src/{effect,promise}/service.ts`
  and `packages/desktop/src/main/service/background-service.ts` follow it.
- `packages/cli/src/services/service-config.ts`: service ports `0xca1e`/`0xca1f`, so a
  Caimex service never contends with an OpenCode one.
- `packages/cli/script/build.ts`: the binary and `OPENCODE_CLI_NAME` are `caimex`.
- CLI and TUI strings (`packages/cli/src`, `packages/tui/src`), the TUI wordmark
  (`tui/src/logo.ts`, wider breakpoints in `component/logo.tsx`), crash reports go to
  our repo.
- Desktop: names, app ids, icons, updater off, no URL scheme, microphone allowed
  (`packages/desktop`); the web wordmark (`packages/ui`, `packages/app/src/new-session`).

**Coming from 1.x**
- `packages/cli/src/database-path.ts` `adoptV1Database`, called from `server-process.ts`:
  on first start, copies `~/.local/share/caimex-code/opencode.db` (and its WAL) into the
  new data folder; upstream's migrations then convert it in place (sessions via
  `core/src/database/v1-migration`, credentials via the `import_legacy_credentials`
  migration). A fresh database is bootstrapped without running migrations, which is why
  the database is copied rather than only `auth.json` being read.
- `core/src/database/migration/20260805200742_import_legacy_credentials.ts`: also reads
  `caimex-code/auth.json`.

**Distribution**
- `packages/cli/src/services/updater.ts`: releases come from GitHub
  (`digiland/caimex-code`, latest release) and npm (`caimex`); the curl method runs our
  `install.sh`. Tests: `packages/cli/test/updater-install.test.ts`.
- `packages/cli/script/build-caimex.ts` (+ root `build-caimex.sh`): archives named
  `caimex-<target>` exactly as 1.x's, so a 1.x `caimex upgrade` lands on 2.x.
- `install.sh`, `npm/caimex/` (postinstall downloads the release binary and checks
  `SHA256SUMS`), `.github/workflows/release-caimex.yml`. Upstream's workflows are parked
  in `.github/workflows-upstream/` and must not run here. npm publishing uses trusted
  publishing tied to `digiland/caimex-code` + `release-caimex.yml`.

**CLI behaviour**
- `caimex auth login` with no argument signs in to Caimex (others by name).
- `caimex models` asks again for a few seconds when a just-started service answers
  before its provider plugins have loaded.

**Plugins and desktop extras**
- `packages/caimex-work` (work modes, commands, skills, tools) and `packages/caimex-voice`
  (turn-by-turn voice; see its README). The desktop's voice control is
  `packages/app/src/session/composer/voice.tsx`, in the `extraControls` slot of
  `composer/composer.tsx` and `composer/editor/editor.tsx`.
- `packages/plugin/src/host.ts`: Bun's ResolveMessage isn't an Error, so a plugin folder
  without optional tui/rpc entries used to fail to load. Worth sending upstream.

## Running

2.x needs Bun 1.4.2:

```bash
export PATH="$HOME/.bun-1.4.2/bin:$PATH"
bun install
bun run --cwd packages/cli dev              # CLI from source (channel "local")
cd packages/desktop && bun run dev          # desktop, isolated local service
./build-caimex.sh --single                  # release archive for this machine
```

A source run uses channel `local`: its own database (`opencode-local.db`) and port, and
no v1 adoption. Plugins are listed in `~/.config/caimex/opencode.jsonc`:

```jsonc
{ "plugins": ["<repo>/packages/caimex-work", "<repo>/packages/caimex-voice"] }
```

## Releasing

Tag `vX.Y.Z` on this branch and push it. The workflow builds every target, creates the
release (archives, `SHA256SUMS`, `install.sh`) and publishes `npm/caimex` at that version.
Both must ship together: the npm package downloads its binary from the release.

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/v2
```

Then:

1. `bun install`, `bun run typecheck`.
2. `cd packages/cli && bun test`. Upstream's service tests time out on a busy machine,
   and `debug paths` and `debug config` fail on a machine with a real config; check
   against a stash of the merge before chasing them.
3. The provider narrowing: on a clean profile `caimex models` lists only `caimex/`
   models (plus a local Ollama, if one is running), and upstream hasn't brought back a
   parked key in `opencode.ts`.
4. `caimex auth login` reaches the gateway's device flow; `caimex --help` says `caimex`.
5. The updater still reads GitHub (`updater.ts`), and `build.ts` still names the binary
   `caimex`.
6. Rebrand new user-facing strings in `packages/cli` and `packages/tui`.
7. Desktop: Settings → Providers lists Caimex, the work modes and `/research` appear, and
   the microphone shows next to the model picker.
