// Caimex identity for the desktop app, shared by the Electron main process,
// electron-builder.config.ts and the build scripts. Keep it free of Electron
// imports — the config and scripts run under plain Bun.
//
// Changing an app id after a release orphans that channel's user data
// (userData lives under appData/<appId>) and its OS launcher pins.

export type Channel = "dev" | "beta" | "prod"

export const APP_IDS: Record<Channel, string> = {
  dev: "zw.co.econetai.caimex.desktop.dev",
  beta: "zw.co.econetai.caimex.desktop.beta",
  prod: "zw.co.econetai.caimex.desktop",
}

export const APP_NAMES: Record<Channel, string> = {
  dev: "Caimex Code Dev",
  beta: "Caimex Code Beta",
  prod: "Caimex Code",
}

export const PACKAGE_NAMES: Record<Channel, string> = {
  dev: "caimex-desktop-dev",
  beta: "caimex-desktop-beta",
  prod: "caimex-desktop",
}

export const ARTIFACT_PREFIX = "caimex-desktop"

export const GITHUB_OWNER = "digiland"
export const GITHUB_REPO = "caimex-code"
export const HOMEPAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

// The renderer (packages/app) parses `opencode://` deep links. We register our
// own scheme with the OS, so installing Caimex never hijacks an OpenCode
// install's links, and rewrite to the upstream prefix before handing them on.
export const URL_SCHEME = "caimex"
const UPSTREAM_SCHEME = "opencode"

export function isDeepLink(url: string) {
  return url.startsWith(`${URL_SCHEME}://`)
}

export function toUpstreamDeepLink(url: string) {
  if (!isDeepLink(url)) return url
  return `${UPSTREAM_SCHEME}://${url.slice(`${URL_SCHEME}://`.length)}`
}

// WSL servers run the Caimex CLI inside the distro. install.sh puts it at
// ~/.local/bin/caimex and takes the release tag through CAIMEXCODE_CHANNEL.
// The desktop app and CLI ship from the same tag, so the versions match.
export const WSL_CLI_PATH = "$HOME/.local/bin/caimex"

export function wslInstallUrl(version: string) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/install.sh`
}
