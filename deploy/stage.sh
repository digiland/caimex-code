#!/usr/bin/env bash
#
# Build the macOS binaries and stage everything nginx will serve into ./public.
# Run this on a Mac (Bun cross-compiles both arm64 and x64 from either arch).
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
PUBLIC="$DEPLOY_DIR/public"
PKG="$ROOT/packages/opencode"

echo "==> Building (all targets; we keep the two darwin ones). This takes a few minutes."
# --skip-embed-web-ui keeps the build lean (CLI/TUI only, no embedded web UI).
# Drop that flag if you need `caimex serve`'s bundled web UI.
( cd "$PKG" && bun run build --skip-embed-web-ui )

mkdir -p "$PUBLIC"

arm="$PKG/dist/opencode-darwin-arm64/bin/opencode"
x64="$PKG/dist/opencode-darwin-x64/bin/opencode"
for f in "$arm" "$x64"; do
  [ -f "$f" ] || { echo "error: expected binary missing: $f" >&2; exit 1; }
done

cp "$arm" "$PUBLIC/caimex-darwin-arm64"
cp "$x64" "$PUBLIC/caimex-darwin-x64"
chmod +x "$PUBLIC/caimex-darwin-arm64" "$PUBLIC/caimex-darwin-x64"

cp "$DEPLOY_DIR/install.sh" "$PUBLIC/install.sh"
cp "$ROOT/caimex.json" "$PUBLIC/caimex.json"

echo "==> Staged into $PUBLIC:"
ls -lh "$PUBLIC"
