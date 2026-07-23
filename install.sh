#!/usr/bin/env bash
# install.sh — fetch and install CaimexCode
# Served from GitHub Releases. Usage:
#   curl -fsSL https://github.com/digiland/caimex-code/releases/latest/download/install.sh | bash
#
# Version selection:
#   CAIMEXCODE_CHANNEL=v1.4.0 curl -fsSL https://.../install.sh | bash
#
# Custom mirror (S3-style layout: <base>/<version>/<archive> and <base>/latest/):
#   CAIMEXCODE_BASE_URL=https://mirror.example.com/caimex-code curl -fsSL .../install.sh | bash
set -euo pipefail

NAME="caimexcode"
GITHUB_REPO="${CAIMEXCODE_GITHUB_REPO:-digiland/caimex-code}"
BASE_URL="${CAIMEXCODE_BASE_URL:-}"            # set to install from a RustFS/S3 mirror instead of GitHub
CHANNEL="${CAIMEXCODE_CHANNEL:-latest}"        # 'latest' or a specific version tag, e.g. v1.4.0
INSTALL_DIR="${CAIMEXCODE_INSTALL_DIR:-$HOME/.local/bin}"

# --- detect platform --------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux)  plat="linux" ;;
  Darwin) plat="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) plat="windows" ;;
  *) echo "Unsupported OS: $os"; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) carch="x64" ;;
  arm64|aarch64) carch="arm64" ;;
  *) echo "Unsupported architecture: $arch"; exit 1 ;;
esac

target="${plat}-${carch}"

if [ -n "$BASE_URL" ]; then
  # RustFS/S3 mirror: upload-caimexcode.sh publishes to ${BUCKET}/${VERSION}/ and
  # ${BUCKET}/latest/ directly (no /releases/ prefix) — matched here.
  release_url="${BASE_URL}/${CHANNEL}"
elif [ "$CHANNEL" = "latest" ]; then
  release_url="https://github.com/${GITHUB_REPO}/releases/latest/download"
else
  release_url="https://github.com/${GITHUB_REPO}/releases/download/${CHANNEL}"
fi

# Archive naming based on platform
if [ "$plat" = "linux" ]; then
  ext="tar.gz"
else
  ext="zip"
fi

archive_name="${NAME}-${target}.${ext}"
archive_url="${release_url}/${archive_name}"
sums_url="${release_url}/SHA256SUMS"

echo "Installing ${NAME} (${CHANNEL}, ${target})"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# --- download archive + checksums --------------------------------------
echo "Downloading ${archive_name}..."
curl -fsSL "$archive_url" -o "${tmp_dir}/${archive_name}"

if curl -fsSL "$sums_url" -o "${tmp_dir}/SHA256SUMS" 2>/dev/null; then
  expected="$(grep "$archive_name" "${tmp_dir}/SHA256SUMS" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    actual="$(sha256sum "${tmp_dir}/${archive_name}" 2>/dev/null | awk '{print $1}' \
              || shasum -a 256 "${tmp_dir}/${archive_name}" | awk '{print $1}')"
    if [ "$expected" != "$actual" ]; then
      echo "Checksum mismatch!"
      echo "  Expected: $expected"
      echo "  Actual:   $actual"
      exit 1
    fi
    echo "Checksum verified ✓"
  else
    echo "warning: Could not find checksum for ${archive_name} in SHA256SUMS"
  fi
else
  echo "warning: SHA256SUMS not found, skipping verification"
fi

# --- extract + install -------------------------------------------------
echo "Extracting..."
if [ "$plat" = "linux" ]; then
  tar -xzf "${tmp_dir}/${archive_name}" -C "$tmp_dir"
else
  unzip -q "${tmp_dir}/${archive_name}" -d "$tmp_dir"
fi

extracted_bin="${tmp_dir}/${NAME}"
if [ ! -f "$extracted_bin" ]; then
  echo "Error: expected binary '${NAME}' not found after extracting ${archive_name}"
  echo "Contents of archive:"
  find "$tmp_dir" -maxdepth 2 -type f
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 0755 "$extracted_bin" "${INSTALL_DIR}/${NAME}"

echo "Installed to ${INSTALL_DIR}/${NAME}"

# --- PATH check --------------------------------------------------------
run_hint="${INSTALL_DIR}/${NAME}"
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    run_hint="${NAME}"
    ;;
  *)
    echo
    echo "Note: ${INSTALL_DIR} is not on your PATH."
    echo "Add this to your shell profile:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo
"${INSTALL_DIR}/${NAME}" --version 2>/dev/null || true

echo
echo "Done! Run '${run_hint}' to start."
