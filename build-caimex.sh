#!/usr/bin/env bash
# build-caimex.sh: compile the caimex CLI (packages/cli, the 2.x line) into release archives
set -euo pipefail

cd packages/cli
bun run build:caimex "$@"
