import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Caimex publishes update metadata for prod only (electron-builder.config.ts).
export const UPDATER_ENABLED = app.isPackaged && CHANNEL === "prod"
