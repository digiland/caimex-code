#!/usr/bin/env bash
# cleanup-caimexcode.sh — remove all local caimexcode build artifacts

set -eu

CAIMEXCODE_DIR="packages/caimexcode"

if [ -d "$CAIMEXCODE_DIR" ]; then
  echo "Cleaning up $CAIMEXCODE_DIR..."
  rm -rf "$CAIMEXCODE_DIR"
  echo "✓ Removed $CAIMEXCODE_DIR"
else
  echo "No build artifacts found at $CAIMEXCODE_DIR"
fi

echo "Done."
