import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import { useBackend } from "../context/backend"
import { useData } from "../context/data"
import type { Provider } from "@opencode-ai/sdk/v2"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const data = useData()
  const backend = useBackend()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  // v2 keeps catalog data in the data context; v1 in sync. The v2 CLI shims the
  // v1 routes empty, so reading v1 here would make the model dialog blank.
  const catalogOptions = (favorites: Favorite[], connected: boolean): CatalogOption[] =>
    backend.integrations
      ? v2CatalogOptions(data, props.providerID, onSelect)
      : v1CatalogOptions(sync.data.provider, props.providerID, { favorites, connected }, onSelect)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      catalogOptions(favorites, connected()),
      filter((option) => {
        if (!showSections) return true
        if (favorites.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID))
          return false
        if (recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID))
          return false
        return true
      }),
      (options) => sortModelOptions(options, props.providerID !== undefined),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...sortModelOptions(
          fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
          false,
        ),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID
      ? backend.integrations
        ? data.location.provider.list()?.find((item) => item.id === props.providerID)
        : sync.data.provider.find((item) => item.id === props.providerID)
      : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}

interface CatalogOption {
  value: { providerID: string; modelID: string }
  title: string
  releaseDate: string | number
  description?: string
  category?: string
  disabled?: boolean
  footer?: string
  onSelect(): void
}

type Favorite = { providerID: string; modelID: string }

function v1CatalogOptions(
  providers: readonly Provider[],
  providerID: string | undefined,
  opts: { favorites: Favorite[]; connected: boolean },
  onSelect: (providerID: string, modelID: string) => void,
): CatalogOption[] {
  return pipe(
    providers,
    sortBy(
      (provider) => provider.id !== "opencode",
      (provider) => provider.name,
    ),
    flatMap((provider) =>
      pipe(
        provider.models,
        entries(),
        filter(([_, info]) => info.status !== "deprecated"),
        filter(([_, info]) => (providerID ? info.providerID === providerID : true)),
        map(([model, info]) => ({
          value: { providerID: provider.id, modelID: model },
          title: info.name ?? model,
          releaseDate: info.release_date ?? 0,
          description: opts.favorites.some((item) => item.providerID === provider.id && item.modelID === model)
            ? "(Favorite)"
            : undefined,
          category: opts.connected ? provider.name : undefined,
          disabled: provider.id === "opencode" && model.includes("-nano"),
          footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
          onSelect: () => onSelect(provider.id, model),
        })),
      ),
    ),
  )
}

function v2CatalogOptions(
  data: ReturnType<typeof useData>,
  providerID: string | undefined,
  onSelect: (providerID: string, modelID: string) => void,
): CatalogOption[] {
  const providers = new Map((data.location.provider.list() ?? []).map((provider) => [provider.id, provider]))
  return pipe(
    data.location.model.list() ?? [],
    filter((info) => info.status !== "deprecated"),
    filter((info) => (providerID ? info.providerID === providerID : true)),
    sortBy((info) => providers.get(info.providerID)?.name ?? info.providerID),
    map((info) => {
      const provider = providers.get(info.providerID)
      return {
        value: { providerID: info.providerID, modelID: info.id },
        title: info.name,
        releaseDate: info.time.released ?? 0,
        category: provider?.name,
        disabled: info.providerID === "opencode" && info.id.includes("-nano"),
        footer: info.cost?.[0]?.input === 0 && info.providerID === "opencode" ? "Free" : undefined,
        onSelect: () => onSelect(info.providerID, info.id),
      }
    }),
  )
}
