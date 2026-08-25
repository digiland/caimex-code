#!/usr/bin/env bun
import { $ } from "bun"

import { buildCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
// Only the dev channel bundles the v2 CLI today (see extraResources in
// electron-builder.config.ts). Shipping it on every channel, and cross-building
// it for non-native targets, are both still open.
if (channel === "dev") await buildCliToResources()
