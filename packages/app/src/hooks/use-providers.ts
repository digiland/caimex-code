import { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { Iterable, pipe } from "effect"
import { createMemo, type Accessor } from "solid-js"
import { selectProviderCatalog } from "./provider-catalog"

// caimex: the fork routes every request through the gateway, so the one
// provider it can offer is the one that belongs at the top of the connect
// dialog and the model picker. Upstream's list of eight is what put OpenCode
// Zen, Anthropic and Copilot in the "Popular" group of a build that cannot use
// them. A provider absent from this list is not hidden — it simply sorts under
// "Other", which is where a provider the user configured themselves belongs.
export const popularProviders = ["caimex"]
const popularProviderSet = new Set(popularProviders)

export function useProviders(directory: Accessor<string | undefined>) {
  const serverSync = useServerSync()
  const params = useParams()
  const dir = () => (directory ? directory() : decode64(params.dir))
  const providers = () => {
    const value = dir()
    const projectStore = value ? serverSync().child(value)[0] : undefined
    if (value)
      return selectProviderCatalog({
        explicit: true,
        directory: value,
        catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      })
    return selectProviderCatalog({
      explicit: false,
      directory: value,
      catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      global: serverSync().data.provider,
    })
  }

  return {
    all: () => providers().all,
    default: () => providers().default,
    defaultModel: () => providers().defaultModel,
    popular: () =>
      pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => popularProviderSet.has(p.id)),
        (v) => Array.from(v),
      ),
    connected: () => {
      const connected = new Set(providers().connected)
      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => connected.has(p.id)),
        (v) => Array.from(v),
      )
    },
    // Despite the name this answers "is there a provider that can run work",
    // and it gates the model picker: false swaps it for the connect-a-provider
    // dialog. Upstream excludes an opencode account holding only zero-cost
    // models, so its free tier keeps being nudged toward an upgrade. The
    // gateway's free tier is a real tier and a connected free account is meant
    // to be able to pick a model, so connection alone is the test here.
    paid: () => {
      const connected = new Set(providers().connected)
      return [...Iterable.filter(providers().all, ([id]) => connected.has(id))]
    },
  }
}
