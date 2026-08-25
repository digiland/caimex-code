import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// Reverse-DNS of the gateway's own domain, caimex.econetai.co.zw. Changing an
// app id changes the userData directory with it, so an existing install starts
// from a clean profile — background-cli.ts keeps looking under the old names
// too, so a v2 daemon already running for the OpenCode-branded build is still
// found rather than duplicated.
const APP_IDS = {
  dev: "zw.co.econetai.caimex.desktop.dev",
  beta: "zw.co.econetai.caimex.desktop.beta",
  prod: "zw.co.econetai.caimex.desktop",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "caimex-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    // caimex: upstream ships the v2 CLI only on dev because v2 is its beta and
    // the packaged app runs the v1 sidecar. This fork defaults to the v2
    // sidecar (see SIDECAR_VERSION in src/main/index.ts), and that sidecar IS
    // this binary — a channel without it packages an app that cannot start.
    {
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Caimex Code",
    schemes: ["caimex"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Caimex Code Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "caimex-code-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Caimex Code Beta",
        protocols: { name: "Caimex Code Beta", schemes: ["caimex"] },
        publish: { provider: "github", owner: "digiland", repo: "caimex-code", channel: "beta" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "caimex-code-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Caimex Code",
        protocols: { name: "Caimex Code", schemes: ["caimex"] },
        publish: { provider: "github", owner: "digiland", repo: "caimex-code", channel: "latest" },
        // No legacy .desktop entry: that one exists to keep GNOME/KDE pins
        // working across an OpenCode-era app id rename this fork never shipped.
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "caimex-code", fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
