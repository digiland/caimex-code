import { createSimpleContext } from "./helper"

// The TUI is shared by both servers, and they do not agree on how a provider is
// connected. v1 serves /provider/{id}/oauth/authorize and stores credentials
// per provider; v2 serves /api/integration/{id}/connect/* and stores them per
// integration. Nothing in a response distinguishes the two reliably, and the v2
// CLI shims 404s on v1 routes into empty defaults, so sniffing would read as
// "no providers" rather than as the wrong backend.
//
// The caller knows which server it started, so it says so.
export interface Backend {
  /** v2: connect flows go through the integration API. */
  integrations: boolean
}

export const { use: useBackend, provider: BackendProvider } = createSimpleContext({
  name: "Backend",
  init: (props: Backend) => props,
})
