import { $ } from "bun"
import { buildCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
// The fork's own CLI, not upstream's download — see buildCliToResources.
await buildCliToResources()
