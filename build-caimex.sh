#!/usr/bin/env bash
# build-caimex.sh — compile caimex (opencode fork) into standalone binaries
set -euo pipefail

cd packages/opencode
bun run build-caimex "$@"
