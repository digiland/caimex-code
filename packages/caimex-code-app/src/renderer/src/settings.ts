import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"

export const TEXT_SIZES = [
  { label: "Small", zoom: 0.9 },
  { label: "Default", zoom: 1 },
  { label: "Large", zoom: 1.1 },
  { label: "Larger", zoom: 1.25 },
] as const

export const CODE_FONTS = {
  "sf-mono": { label: "SF Mono", stack: `"SF Mono", ui-monospace, Menlo, monospace` },
  menlo: { label: "Menlo", stack: `Menlo, ui-monospace, monospace` },
  monaco: { label: "Monaco", stack: `Monaco, ui-monospace, monospace` },
  courier: { label: "Courier", stack: `"Courier New", Courier, monospace` },
} as const

export type Settings = { zoom: number; codeFont: keyof typeof CODE_FONTS }

const KEY = "caimex.settings"
const DEFAULTS: Settings = { zoom: 1, codeFont: "sf-mono" }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    return {
      zoom: TEXT_SIZES.some((size) => size.zoom === value.zoom) ? value.zoom! : DEFAULTS.zoom,
      codeFont: value.codeFont && value.codeFont in CODE_FONTS ? value.codeFont : DEFAULTS.codeFont,
    }
  } catch {
    return DEFAULTS
  }
}

// Light and dark follow macOS on purpose; there is no theme setting.
export function createSettings() {
  const [settings, setSettings] = createStore<Settings>(load())
  createEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...settings }))
    } catch {
      // keeps working for this run
    }
    window.caimex.setZoom(settings.zoom)
    document.documentElement.style.setProperty("--code-font", CODE_FONTS[settings.codeFont].stack)
  })
  return [settings, setSettings] as const
}
