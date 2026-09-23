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
  // A folder's commands rarely change; fetch once per folder.
  const cache = new Map<string, Promise<Command[]>>()
  const commands = (directory: string) => {
    let found = cache.get(directory)
    if (!found) {
      found = api()
        .commands(directory)
        .catch(() => {
          cache.delete(directory)
          return []
        })
      cache.set(directory, found)
    }
    return found
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
