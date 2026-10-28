import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

import { APP_IDS, APP_NAMES, ARTIFACT_PREFIX, GITHUB_OWNER, GITHUB_REPO, PACKAGE_NAMES, URL_SCHEME } from "./src/branding"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

// Signing and notarization switch on only when their credentials are present,
// so the same config produces unsigned builds until those secrets exist.
const canSignWindows = Boolean(process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME)
const canSignMac = Boolean(process.env.CSC_LINK || process.env.CSC_KEYCHAIN)
const canNotarizeMac = canSignMac && Boolean(process.env.APPLE_API_KEY)

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return
  if (!canSignWindows) return

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

const getBase = (appId: string): Configuration => ({
  artifactName: `${ARTIFACT_PREFIX}-\${os}-\${arch}.\${ext}`,
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "zw.co.econetai.caimex.desktop"
  // becomes "zw.co.econetai.caimex.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
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
    notarize: canNotarizeMac,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: canSignMac,
  },
  protocols: {
    name: APP_NAMES[channel],
    schemes: [URL_SCHEME],
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

function getConfig(): Configuration {
  const appId = APP_IDS[channel]
  const base = getBase(appId)
  const linuxPackage = {
    deb: { packageName: PACKAGE_NAMES[channel], fpm: [metainfoFpm(appId)] },
    rpm: { packageName: PACKAGE_NAMES[channel], fpm: [metainfoFpm(appId)] },
  }

  // Only prod publishes update metadata. Dev and beta builds have the updater
  // switched off (see src/main/constants.ts) — there is no separate beta repo,
  // so a beta pointed here would "update" itself to the prod build.
  const publish: Configuration["publish"] =
    channel === "prod" ? { provider: "github", owner: GITHUB_OWNER, repo: GITHUB_REPO, channel: "latest" } : null

  return {
    ...base,
    ...linuxPackage,
    appId,
    productName: APP_NAMES[channel],
    publish,
  }
}

export default getConfig()
