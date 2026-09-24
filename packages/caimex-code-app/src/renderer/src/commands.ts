import type { Api, Command } from "./api"
import type { Suggestion } from "./components/composer"

// App commands, handled here rather than sent to the model.
export const BUILTINS = [
  { name: "new", description: "Start a new session" },
  { name: "plan", description: "Switch to plan mode (no edits)" },
  { name: "build", description: "Switch to build mode" },
  { name: "settings", description: "Open settings" },
] as const

export type Builtin = (typeof BUILTINS)[number]["name"]

export const isBuiltin = (name: string): name is Builtin => BUILTINS.some((command) => command.name === name)

export function parseCommand(text: string) {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() } : undefined
}

// Project commands are prompt templates: $ARGUMENTS is everything after the name,
// $1, $2… the individual words.
export function expand(template: string, args: string) {
  const words = args.split(/\s+/).filter(Boolean)
  return template.replaceAll("$ARGUMENTS", args).replace(/\$(\d+)/g, (_, n: string) => words[Number(n) - 1] ?? "")
}

export function createSuggestions(api: () => Api) {
  // A folder's commands rarely change, so keep them briefly. A folder the daemon has just
  // opened answers before its plugins finish loading, so an empty answer isn't kept.
  const cache = new Map<string, { at: number; value: Promise<Command[]> }>()
  const commands = (directory: string) => {
    const found = cache.get(directory)
    if (found && Date.now() - found.at < 60_000) return found.value
    const value = api()
      .commands(directory)
      .then((list) => {
        if (!list.length) cache.delete(directory)
        return list
      })
      .catch(() => {
        cache.delete(directory)
        return [] as Command[]
      })
    cache.set(directory, { at: Date.now(), value })
    return value
  }

  const suggest =
    (directory: string | undefined) =>
    async (kind: "mention" | "command", query: string): Promise<Suggestion[]> => {
      if (kind === "command") {
        const project = directory ? await commands(directory) : []
        return [
          ...BUILTINS.map((command) => ({ name: command.name, description: command.description })),
          ...project.map((command) => ({
            name: command.name,
            description: command.description ?? command.template.split("\n")[0].slice(0, 80),
          })),
        ]
          .filter((command) => command.name.startsWith(query.toLowerCase()))
          .map((command) => ({ label: `/${command.name}`, detail: command.description, insert: `/${command.name}` }))
      }
      if (!directory) return []
      // A trailing slash means "show this folder"; otherwise fuzzy-find by name.
      const entries = query.endsWith("/")
        ? await api().listDir(directory, query.slice(0, -1))
        : await api().findFiles(directory, query, 12)
      return entries.slice(0, 12).map((entry) => ({
        label: entry.path,
        detail: entry.type === "directory" ? "folder" : undefined,
        insert: `@${entry.path}`,
        more: entry.type === "directory",
      }))
    }

  return { commands, suggest }
}
