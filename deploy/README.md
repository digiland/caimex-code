# Deploying Caimex Code (curl installer via local Docker server)

Compile the macOS binaries, host them on a local server with Docker, and let
org users install with one `curl` command.

```
build (Mac)  ──>  stage ./public  ──>  docker (nginx)  ──>  curl | bash (users)
```

## 1. Build + stage (on a Mac)

```bash
cd deploy
./stage.sh
```

This runs `bun run build` and copies into `deploy/public/`:

| File                  | What it is                          |
| --------------------- | ----------------------------------- |
| `caimex-darwin-arm64` | binary for Apple Silicon Macs       |
| `caimex-darwin-x64`   | binary for Intel Macs               |
| `install.sh`          | the installer users curl            |
| `caimex.json`         | default gateway config              |

> Bun cross-compiles both arches from one machine, so you don't need an Intel Mac.

## 2. Set your server address

Edit `deploy/install.sh` and replace `CHANGE-ME:8080` with the host/port users
will reach (e.g. `code-dist.internal:8080`), then re-run `./stage.sh` so the
copy in `public/` is updated.

## 3. Serve it with Docker

```bash
cd deploy
docker compose up -d --build
# now serving on http://<this-server>:8080/
```

Verify:

```bash
curl -fsSL http://localhost:8080/install.sh | head
curl -fsI  http://localhost:8080/caimex-darwin-arm64   # 200 OK
```

## 4. Org users install

```bash
curl -fsSL http://YOUR-SERVER:8080/install.sh | bash
```

The installer detects arch, drops the binary at `/usr/local/bin/caimex`, clears
the macOS quarantine flag, and prints the gateway-config steps.

Override the source or install location without editing the script:

```bash
curl -fsSL http://YOUR-SERVER:8080/install.sh \
  | CAIMEX_DOWNLOAD_URL=http://YOUR-SERVER:8080 CAIMEX_INSTALL_DIR="$HOME/.local/bin" bash
```

## Notes

- **Gatekeeper:** curl-downloaded binaries aren't quarantined, so they run
  without "unidentified developer" prompts. For a fully managed fleet, sign with
  a Developer ID cert + notarize; not required for this flow.
- **Updates:** re-run `./stage.sh`, then `docker compose up -d --build`. Users
  re-run the same curl command to upgrade.
- **The binary still needs the gateway** reachable at the `baseURL` in
  `caimex.json`, plus `CAIMEX_API_KEY` set in each user's shell.
- **HTTPS:** to serve over TLS, put this behind your existing reverse proxy or
  add a certificate to the nginx config.
