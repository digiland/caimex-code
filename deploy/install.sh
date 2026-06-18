#!/usr/bin/env bash
#
# Caimex Code installer.
#   curl -fsSL http://YOUR-SERVER:8080/install.sh | bash
#
# Detects the Mac's architecture, downloads the matching binary, installs it as
# `caimex` on PATH, and clears the macOS quarantine flag.
set -euo pipefail

# The server hosting the binaries. Override at install time:
#   curl -fsSL .../install.sh | CAIMEX_DOWNLOAD_URL=http://host:8080 bash
BASE_URL="${CAIMEX_DOWNLOAD_URL:-http://CHANGE-ME:8080}"
INSTALL_DIR="${CAIMEX_INSTALL_DIR:-/usr/local/bin}"
BIN_NAME="caimex"

os="$(uname -s)"
arch="$(uname -m)"

if [ "$os" != "Darwin" ]; then
  echo "error: this installer supports macOS only (detected: $os)" >&2
  exit 1
fi

case "$arch" in
  arm64)  asset="caimex-darwin-arm64" ;;   # Apple Silicon
  x86_64) asset="caimex-darwin-x64"  ;;   # Intel
  *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
esac

url="$BASE_URL/$asset"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Downloading caimex ($arch) from $url ..."
curl -fSL --proto '=http,https' "$url" -o "$tmp"
chmod +x "$tmp"
xattr -d com.apple.quarantine "$tmp" 2>/dev/null || true

target="$INSTALL_DIR/$BIN_NAME"
mkdir -p "$INSTALL_DIR" 2>/dev/null || true
if [ -w "$INSTALL_DIR" ]; then
  mv "$tmp" "$target"
else
  echo "Installing to $target (needs sudo) ..."
  sudo mv "$tmp" "$target"
fi
trap - EXIT

echo "Installed: $target"
"$target" --version || true

cat <<EOF

Next steps
----------
1. Drop in the gateway config:

     mkdir -p ~/.config/caimex-code
     curl -fsSL $BASE_URL/caimex.json -o ~/.config/caimex-code/caimex.json

2. Log in (pick "Login with Caimex" for the browser flow, or paste a key):

     caimex auth login

3. Run it:

     caimex                 # interactive TUI
     caimex run "..."       # one-shot
     caimex models          # list models from the gateway

(Caimex needs the gateway reachable at the baseURL in caimex.json.)
EOF
