#!/usr/bin/env bash
# build-caimexcode.sh — compile caimexcode (opencode fork) into standalone binaries
set -euo pipefail

cd packages/opencode
bun run build-caimexcode "$@"
