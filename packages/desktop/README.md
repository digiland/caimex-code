# Caimex Code Desktop

The Caimex Code desktop app, built with Electron. It bundles the same server as
the `caimex` CLI, so every model goes through the Caimex gateway.

App ids, product names, the `caimex://` URL scheme and the update repo are set
in `src/branding.ts`.

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

Set `OPENCODE_CHANNEL=prod` for a release-identity build (`dev` is the default).
Releases are built by `.github/workflows/release-caimex.yml` on a `vX.Y.Z` tag.
