#!/usr/bin/env bun
import { $ } from "bun"

import { buildCaimexCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
// caimex ships its own CLI in every channel; upstream only bundled it for dev.
await buildCaimexCliToResources()
