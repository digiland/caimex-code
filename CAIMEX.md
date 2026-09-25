# Caimex Desktop

A fork of OpenCode's 2.x line (`upstream/v2`) for the **desktop app only**: OpenCode's
2.x desktop, with the Caimex gateway as its provider, work modes and voice. The Caimex
**CLI** is a separate fork (`digiland/caimex-code`) and isn't touched from here.

Changes are kept few and marked `// Caimex Desktop:` so upstream merges stay easy.

## Our changes, by file

- `packages/core/src/plugin/provider/caimex.ts` (+ `provider.ts` registration): the Caimex
  gateway provider. Keep it in step with the CLI fork's
  `packages/core/src/plugin/provider/caimex.ts` (gateway URLs, login-origin fix,
  User-Agent, token key names).
- `packages/core/src/plugin/provider/opencode.ts`: OpenCode Zen's free tier stays hidden.
- `packages/util/src/global.ts`: app id `caimex-desktop` (own config, data and daemon);
  `packages/client/src/{effect,promise}/service.ts` and
  `packages/desktop/src/main/service/background-service.ts` follow it.
- `packages/desktop`: names and app ids (`src/main/constants.ts`,
  `electron-builder.config.ts`, `scripts/copy-metainfo.ts`), icons (`icons/`, masters in
  `icons/master/`), updater off, no `opencode://` scheme, no notarization, microphone
  allowed (audio only) in `src/main/windows/security.ts`.
- `packages/ui`: the "caimex code" wordmark (`components/logo.tsx`,
  `typography/wordmark/wordmark.tsx`); `packages/app/src/new-session/wordmark.tsx` aspect.
- `packages/plugin/src/host.ts`: Bun's ResolveMessage isn't an Error; a plugin folder
  without optional tui/rpc entries used to fail to load. Worth sending upstream.
- `packages/app`: the voice control (`src/session/composer/voice.tsx`) and the
  `extraControls` slot it uses in `composer/composer.tsx` and `composer/editor/editor.tsx`.
- New packages: `packages/caimex-work` (work modes, commands, skills, tools) and
  `packages/caimex-voice` (voice; see its README).

## Running

2.x needs Bun 1.4.2 (`packageManager` in `package.json`):

```bash
export PATH="$HOME/.bun-1.4.2/bin:$PATH"
bun install
cd packages/desktop && bun run dev
```

Plugins are listed in `~/.config/caimex-desktop/opencode.jsonc`:

```jsonc
{ "plugins": ["<repo>/packages/caimex-work", "<repo>/packages/caimex-voice"] }
```

A plugin folder needs a `server.ts` entry (see `plugin/src/host.ts` `resolve`). The
daemon reloads plugins when that file changes.

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/v2
```

Then: `bun install`, typecheck `core`, `app`, `desktop`, `caimex-work` and `caimex-voice`,
run the desktop, and check that Settings → Providers lists Caimex (and the free OpenCode
tier isn't offered), the work modes and `/research` appear, and the microphone shows next
to the model picker.
