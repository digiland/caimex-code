# Caimex Code

An AI coding agent in your terminal and on your desktop, working through the
**Caimex gateway**: one sign-in, every model the gateway offers.

Caimex Code is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT),
built on its 2.x line. It is not affiliated with the OpenCode team (see
[NOTICE.md](./NOTICE.md)).

## Install

```bash
curl -fsSL https://github.com/digiland/caimex-code/releases/latest/download/install.sh | bash
```

or

```bash
npm i -g caimex
```

The installer puts `caimex` in `~/.local/bin`. Pin a version with
`CAIMEXCODE_CHANNEL=v2.0.0`, change the location with `CAIMEXCODE_INSTALL_DIR`.
Binaries for every platform are on the
[releases page](https://github.com/digiland/caimex-code/releases).

## Sign in

```bash
caimex auth login
```

The CLI prints a short code and opens the gateway's sign-in page; approve it there.
`CAIMEX_API_KEY` in the environment works too.

## Usage

```bash
caimex                          # interactive TUI
caimex run "Explain this repo"  # non-interactive, prints the answer
caimex models                   # models the gateway offers (caimex/<model-id>)
caimex upgrade                  # update from GitHub Releases or npm
caimex --help                   # everything else
```

The CLI and Caimex Desktop share one background service, one sign-in and one session
list. Configuration lives in `~/.config/caimex/opencode.jsonc`.

### Coming from 1.x

The first start of 2.x copies the 1.x database from `~/.local/share/caimex-code/`
and converts it: your sessions and your Caimex sign-in come across. The 1.x files are
left as they were.

### Gateway settings

| Variable              | Default                                 |
| --------------------- | --------------------------------------- |
| `CAIMEX_API_BASE_URL` | `https://caimex.econetai.co.zw:2052/v1` |
| `CAIMEX_GATEWAY_URL`  | the gateway origin (device sign-in)     |
| `CAIMEX_API_KEY`      | a key, instead of `caimex auth login`   |

## Development

Bun 1.4.2 (see `packageManager` in `package.json`):

```bash
bun install
bun run --cwd packages/cli dev            # the CLI from source
./build-caimex.sh --single                # release archive for this machine
```

Archives land in `packages/caimex/` as `caimex-<os>-<arch>.{tar.gz,zip}` with
`SHA256SUMS`. Pushing a tag `vX.Y.Z` builds every target, creates the GitHub Release
and publishes `caimex` to npm (`.github/workflows/release-caimex.yml`). How the fork is
put together, and how to merge upstream, is in [CAIMEX.md](./CAIMEX.md).

## License

MIT. Original code Copyright (c) 2025 opencode; modifications Copyright (c) 2026
Caimex. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).
