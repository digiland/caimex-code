import { Effect } from "effect"
import { define } from "./internal"

// Caimex desktop builds are gateway-only: every model is served through the
// Caimex gateway, so the provider picker must not offer upstream providers
// (OpenCode Zen, Anthropic, OpenAI, ...) that cannot authenticate here.
// This plugin is added after every provider plugin in internal.ts, and
// catalog transforms replay in registration order on every reload, so
// removing foreign providers here keeps them out permanently. Runs only when
// the process declares itself the desktop client (OPENCODE_CLIENT=desktop,
// set in packages/desktop preferAppEnv), leaving CLI and TUI builds untouched.
const KEEP = "caimex"

export const DesktopCatalogPlugin = define({
  id: "desktop-catalog",
  effect: (ctx) =>
    Effect.sync(() => {
      if (process.env.OPENCODE_CLIENT !== "desktop") return
      ctx.catalog.transform((catalog) => {
        for (const record of [...catalog.provider.list()]) {
          if (record.provider.id !== KEEP) catalog.provider.remove(record.provider.id)
        }
      })
    }),
})
