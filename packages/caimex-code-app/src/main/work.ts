import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, ipcMain } from "electron"

// Work tasks run as ordinary daemon sessions, each in its own folder under one root, so
// the Code tab can leave them out and a task's reports and drafts stay together.
export const workRoot = () => process.env.CAIMEX_WORK_ROOT || join(homedir(), "Caimex Work")

// The work-modes plugin (packages/caimex-work): the source tree in development (its
// dependencies resolve from the workspace); when packaged, a folder in Resources holding
// it bundled to one file, since the copy there has no node_modules (scripts/stage.ts).
const pluginPath = () =>
  app.isPackaged ? join(process.resourcesPath, "caimex-work") : join(app.getAppPath(), "..", "caimex-work")

// Plugins a packaged app carries in Resources (work modes and voice). A dev run loads
// them from source through the config instead.
export const bundledPlugins = () =>
  app.isPackaged ? [pluginPath(), join(process.resourcesPath, "caimex-voice")] : []

const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 48) || "task"

// A new folder for a task; a name already taken gets a numeric suffix.
export function newFolder(name: string) {
  const root = workRoot()
  mkdirSync(root, { recursive: true })
  const base = slug(name)
  let folder = join(root, base)
  for (let n = 2; existsSync(folder); n++) folder = join(root, `${base}-${n}`)
  mkdirSync(folder)
  return folder
}

export function registerWork() {
  ipcMain.handle("work:info", () => {
    mkdirSync(workRoot(), { recursive: true })
    return { root: workRoot(), plugin: pluginPath(), pluginExists: existsSync(pluginPath()) }
  })
  ipcMain.handle("work:newFolder", (_event, name: unknown) => newFolder(typeof name === "string" ? name : "task"))
}
