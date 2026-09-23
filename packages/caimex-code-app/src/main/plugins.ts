import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { ipcMain } from "electron"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

// v2 daemon plugins. The v2 API has no config or plugin routes, so they are managed here
// in the global config and take effect when the daemon restarts.
//
// Which file: the daemon reads config.json, caimex.json(c) and opencode.json(c) from the
// global config folder, but a file that looks like a v1 config (caimex.json has
// `provider` and `enabled_providers`) is migrated and only its v1 `plugin` key survives.
// opencode.jsonc is plain v2, so its `plugins` key is read as-is; the v1 CLI reading
// the same file only notes the key as unsupported. Edits go through jsonc-parser so
// comments and formatting survive.

const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "caimex-code")
const pluginFile = () => join(configDir(), "opencode.jsonc")

export type PluginEntry = { package: string; options?: Record<string, unknown> }

function read(file: string) {
  if (!existsSync(file)) return { text: "", value: {} as Record<string, unknown> }
  const text = readFileSync(file, "utf8")
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true }) as Record<string, unknown> | undefined
  if (errors.length) throw new Error(`${file} isn't valid JSON(C); fix it before managing plugins here.`)
  return { text, value: value ?? {} }
}

const normalize = (item: unknown): PluginEntry | undefined =>
  typeof item === "string"
    ? { package: item }
    : item && typeof item === "object" && typeof (item as PluginEntry).package === "string"
      ? (item as PluginEntry)
      : undefined

function list() {
  const dir = configDir()
  const entries = ((read(pluginFile()).value.plugins as unknown[] | undefined) ?? []).flatMap((item) => normalize(item) ?? [])
  // Plugin files dropped into the config folder load without any config entry.
  const files = ["plugin", "plugins"].flatMap((folder) => {
    const path = join(dir, folder)
    return existsSync(path)
      ? readdirSync(path)
          .filter((name) => /\.(ts|js)$/.test(name))
          .map((name) => join(path, name))
      : []
  })
  // v1 plugins (the CLI's own plugin API) from caimex.json, shown for reference only.
  const v1 = (() => {
    try {
      const value = read(join(dir, "caimex.json")).value.plugin
      return Array.isArray(value) ? value.map((item) => (Array.isArray(item) ? String(item[0]) : String(item))) : []
    } catch {
      return []
    }
  })()
  return { file: pluginFile(), entries, files, v1 }
}

function write(entries: PluginEntry[]) {
  const file = pluginFile()
  mkdirSync(configDir(), { recursive: true })
  const { text } = read(file)
  const base = text.trim() ? text : `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
  const value = entries.map((entry) => (entry.options && Object.keys(entry.options).length ? entry : entry.package))
  const edits = modify(base, ["plugins"], value.length ? value : undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  })
  writeFileSync(file, applyEdits(base, edits))
}

const valid = (entry: unknown): entry is PluginEntry =>
  !!entry &&
  typeof (entry as PluginEntry).package === "string" &&
  (entry as PluginEntry).package.trim().length > 0 &&
  ((entry as PluginEntry).options === undefined ||
    (typeof (entry as PluginEntry).options === "object" && !Array.isArray((entry as PluginEntry).options)))

export function registerPlugins() {
  ipcMain.handle("plugins:list", () => list())
  ipcMain.handle("plugins:save", (_event, entries: unknown) => {
    if (!Array.isArray(entries) || !entries.every(valid)) throw new Error("Bad plugin list")
    write(entries.map((entry) => ({ package: entry.package.trim(), options: entry.options })))
    return list()
  })
}
