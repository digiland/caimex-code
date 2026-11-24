import path from "node:path"

export type Channel = "local" | "dev" | "beta" | "prod"

// Caimex Desktop: its own names and ids (upstream: OpenCode, ai.opencode.desktop*), kept in
// step with electron-builder.config.ts and scripts/copy-metainfo.ts.
const appNames: Record<Channel, string> = {
  local: "Caimex Desktop Dev",
  dev: "Caimex Desktop Dev",
  beta: "Caimex Desktop Beta",
  prod: "Caimex Desktop",
}

const appIDs: Record<Channel, string> = {
  local: "zw.co.econetai.caimexdesktop.dev",
  dev: "zw.co.econetai.caimexdesktop.dev",
  beta: "zw.co.econetai.caimexdesktop.beta",
  prod: "zw.co.econetai.caimexdesktop",
}

// Unpackaged dev runs keep the dev profile directory (`appID`), but use a separate Windows
// AppUserModelID: Electron writes a Start Menu `Electron.lnk` with the active AUMID on the first
// toast, which would otherwise shadow the installed OpenCode Dev shortcut and route its toast
// clicks to bare `electron.exe`.
const LOCAL_APP_USER_MODEL_ID = "zw.co.econetai.caimexdesktop.local"

export function resolveIdentity(channel: Channel, packaged: boolean) {
  return {
    appName: packaged ? appNames[channel] : "Caimex Desktop Dev",
    appID: packaged ? appIDs[channel] : "zw.co.econetai.caimexdesktop.dev",
    appUserModelID: packaged ? appIDs[channel] : LOCAL_APP_USER_MODEL_ID,
  }
}

export function isCollidingDevShortcut(
  shortcut: { readonly appUserModelId?: string; readonly target: string },
  appUserModelID: string,
  execPath: string,
) {
  if (!shortcut.appUserModelId) return false

  if (shortcut.appUserModelId.toLowerCase() !== appUserModelID.toLowerCase()) return false

  return path.win32.normalize(shortcut.target).toLowerCase() !== path.win32.normalize(execPath).toLowerCase()
}
