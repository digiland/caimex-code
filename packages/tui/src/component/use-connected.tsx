import { createMemo } from "solid-js"
import { useSync } from "../context/sync"

export function useConnected() {
  const sync = useSync()
  // "Connected" = at least one provider with real credentials. `provider_next.connected`
  // is auth-aware (a config provider like the Caimex gateway only appears once it has a
  // key), so an unauthenticated first-run user reads as not connected and gets prompted to
  // log in. The free `opencode` tier doesn't count — it's available without logging in.
  return createMemo(() => sync.data.provider_next.connected.some((id) => id !== "opencode"))
}
