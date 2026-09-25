import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

// Caimex Desktop: no update server yet, and upstream's would replace this build with
// stock OpenCode.
export const UPDATER_ENABLED = false

// Caimex Desktop: its own names and ids, so it never shares state, the single-instance
// lock or a Dock entry with OpenCode or with the Caimex CLI fork's apps.
const appNames: Record<string, string> = {
  dev: "Caimex Desktop Dev",
  beta: "Caimex Desktop Beta",
  prod: "Caimex Desktop",
}
const appIDs: Record<string, string> = {
  dev: "zw.co.econetai.caimexdesktop.dev",
  beta: "zw.co.econetai.caimexdesktop.beta",
  prod: "zw.co.econetai.caimexdesktop",
}
// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "Caimex Desktop Dev"
export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "zw.co.econetai.caimexdesktop.dev"
