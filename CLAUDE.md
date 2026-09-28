# CLAUDE.md

Guidance for Claude Code (and other agents) working on **Caimex Code 2.x**.

## What this is

A fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT) on its **2.x line**,
routing every model call through the **Caimex gateway** (OpenAI-compatible, default
`https://caimex.econetai.co.zw:2052/v1`). One branch builds both:

- the **`caimex` CLI** (`packages/cli`, TUI in `packages/tui`), released to GitHub
  Releases and npm as `caimex`;
- **Caimex Desktop** (`packages/desktop` + `packages/app`), not released yet.

They share one app id, **`caimex`**: `~/.config/caimex`, `~/.local/share/caimex`, one
sign-in, one session store, one background service.

Three docs, each with one job:

- **`AGENTS.md`**: upstream's rules for this codebase (architecture, generated client,
  TUI stories, commit style). Follow it, except where this file says otherwise.
- **`CAIMEX.md`**: the inventory of every fork change, file by file. **Keep it current:**
  every change you make to upstream code gets a line there, and a `// Caimex:` comment
  at the change.
- **This file**: how to work here and how to stay in sync with upstream.

## Branches and remotes

- **`caimex-v2`** is our trunk: all work and all releases. (Upstream's `AGENTS.md`
  says the default branch is `v2`; for us that means `upstream/v2`, the branch we
  merge *from*.)
- `origin` = `github.com/digiland/caimex-code`. `upstream` = `github.com/anomalyco/opencode`.
- `caimex` is the old 1.x line (`packages/opencode`, merged from `upstream/dev`).
  Maintenance only; don't port new work there.
- **Upstream's tags are not fetched** (`git config remote.upstream.tagOpt --no-tags`).
  Upstream tags `v2.0.x` too, and a fetched `v2.0.0` once shadowed ours. Keep it off
  in every clone.
- Branch names: short, hyphenated, no `feat/` prefix (as `AGENTS.md`).

## Runtime: Bun 1.4.2

The 2.x line needs Bun 1.4.2 exactly (`packageManager` in `package.json`; scripts
refuse other versions). It is installed beside the system Bun, which stays 1.3.x for
the 1.x repo:

```bash
export PATH="$HOME/.bun-1.4.2/bin:$PATH"
bun install
```

## Commands

```bash
bun run --cwd packages/cli dev              # CLI/TUI from source (channel "local")
bun run --cwd packages/cli dev -- models    # any command from source
cd packages/desktop && bun run dev          # desktop with an isolated local service
./build-caimex.sh --single                  # release archive for this machine
bun run typecheck && bun run lint           # both must be clean
cd packages/<pkg> && bun test               # tests are per package
```

A source run uses channel `local`: its own database (`opencode-local.db`), its own
port, no 1.x adoption. To test what users get, build (`./build-caimex.sh --single`) and
run `packages/cli/dist/cli-<target>/bin/caimex`, on a throwaway profile
(`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` pointed at a
scratch folder). `caimex service stop` before retrying: a running service keeps the
old binary. The build reorders `packages/cli/package.json`
(`bun install --os=* --cpu=*`); `git checkout packages/cli/package.json` afterwards.

## Staying in sync with upstream

Merge often: small merges are easy, big ones aren't.

```bash
git fetch upstream
git switch caimex-v2
git merge upstream/v2
```

Conflicts are mostly in our marked `// Caimex:` edits; `CAIMEX.md` lists each one and
why. Then, **every time**, before tagging:

1. `bun install`, then `bun run typecheck` and `bun run lint`: both clean.
2. Tests: `cd packages/cli && bun test`, `packages/tui`, `packages/core`. Some fail on
   any machine: the managed-service tests time out, `debug paths`/`debug config` read
   the real profile, and TUI `dialog-shell-output` times out. Stash the merge and run the
   same file to confirm a failure is pre-existing before chasing it.
3. **Caimex must stay the only provider.** On a throwaway profile, `caimex models` lists
   only `caimex/` models (a local Ollama, if one is running, is fine). Upstream edits
   `packages/core/src/plugin/provider/opencode.ts` often: it must not park a `"public"`
   key or leave free OpenCode models enabled.
4. **The name and identity held:** `caimex --help` says `caimex`; `build.ts` still names
   the binary `caimex`; `util/src/global.ts` still says `caimex`; service ports are still
   `0xca1e`/`0xca1f`.
5. **Updates still come from us:** `packages/cli/src/services/updater.ts` still reads
   GitHub (`digiland/caimex-code`) and npm `caimex`, and `updater-action.ts` still never
   offers an older release. `test/updater-*.test.ts` cover both.
6. **Sign-in:** `caimex auth login` reaches the gateway's device flow (it prints a code;
   no need to finish).
7. **New user-facing strings:** grep the merge for `OpenCode`/`opencode ` in
   `packages/cli/src`, `packages/tui/src` and the system prompts
   (`packages/core/src/plugin/system-prompt/*.txt`, `session/runner/prompt/system.txt`)
   and rebrand what users see. Leave identifiers, package names (`@opencode/*`) and
   config file names (`opencode.jsonc`) alone.
8. **New GitHub workflows:** upstream adds files to `.github/workflows/`. Move them to
   `.github/workflows-upstream/`; only `release-caimex.yml` may run here.
9. **Migrations:** if upstream touched `core/src/database/migration/*_import_legacy_credentials.ts`
   or `v1-migration`, re-check that a copy of a 1.x database still converts (see the
   1.x adoption notes in `CAIMEX.md`).
10. Desktop: `cd packages/desktop && bun run dev`; Settings → Providers lists Caimex, the
    work modes and `/research` appear, the microphone shows by the model picker.
11. Update `CAIMEX.md` for anything the merge changed about our edits, and this file if
    the process changed.

## Releasing

Tags on `caimex-v2` trigger `.github/workflows/release-caimex.yml`: build every target,
GitHub Release (archives, `SHA256SUMS`, `install.sh`), then publish `npm/caimex` with
trusted publishing (no token; configured for `digiland/caimex-code` + that workflow).

- `vX.Y.Z` is a normal release: GitHub's latest, npm `latest`. Every 1.x and 2.x
  `caimex upgrade` follows it.
- `vX.Y.Z-beta.N` (any suffix) is a pre-release: never GitHub's latest, npm `next`
  (`npm i -g caimex@next`). Use it to try a risky merge on real machines first.
- Our versions are our own SemVer, not upstream's (2.0.0 is our first 2.x).
- The npm package ships no binary; its postinstall downloads the release's archive and
  checks `SHA256SUMS`, so a release and its npm publish must ship together. Archive
  names (`caimex-<os>-<arch>[-baseline][-musl]`) are shared by `build-caimex.ts`,
  `install.sh` and `npm/caimex/install.mjs`; change all three or none.

## Rules of thumb

- Keep the fork **minimal and mergeable**: few, marked edits in upstream files; new
  behaviour in our own files or packages (`packages/caimex-work`, `packages/caimex-voice`).
  Never mass-replace `opencode` across the tree.
- **Don't** make Caimex the only provider with `enabled_providers` defaults: that stops
  providers a user configured themselves from loading, with no error.
- The gateway provider is `packages/core/src/plugin/provider/caimex.ts`. The 1.x
  equivalent is on the `caimex` branch; the gateway endpoints and the `caimex-code`
  User-Agent must match between them.
- After changing the public protocol, regenerate the client (`AGENTS.md`); don't edit
  generated files.
- Licensing: keep `LICENSE` and `NOTICE.md`; don't present this as OpenCode.
