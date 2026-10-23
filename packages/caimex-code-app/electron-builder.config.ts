// Packaging for Caimex Code (macOS). Run `bun run stage` first: it puts the daemon and
// the bundled plugins in resources/ (see scripts/stage.ts).
//
// Signing follows the environment, so the same config serves a release and a local try:
//   CSC_LINK + CSC_KEY_PASSWORD        a Developer ID certificate (base64 .p12): signed,
//                                      hardened runtime
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//                                      also notarized, so it opens on any Mac
//   neither                            unsigned, for this Mac only
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { CustomMacSignOptions } from "app-builder-lib"
import type { Configuration } from "electron-builder"

const packageDir = path.dirname(fileURLToPath(import.meta.url))

const signed = !!(process.env.CSC_LINK || process.env.CSC_NAME)
const notarized =
  signed && !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

// The daemon is a Bun executable: it needs JIT and loads native libraries that Apple
// didn't sign, which Electron and its helpers don't.
function macSignOptions(options: CustomMacSignOptions): CustomMacSignOptions {
  return {
    ...options,
    optionsForFile: (file) => {
      const defaults = options.optionsForFile?.(file)
      if (file !== path.join(options.app, "Contents/Resources/caimex-cli")) return defaults ?? {}
      return { ...defaults, entitlements: path.join(packageDir, "resources/entitlements.cli.plist") }
    },
  }
}

const config: Configuration = {
  appId: "zw.co.econetai.caimex.code",
  productName: "Caimex Code",
  artifactName: "caimex-code-mac-${arch}.${ext}",
  directories: { output: "dist", buildResources: "resources" },
  files: ["out/**/*", "package.json", "!**/node_modules/**"],
  extraResources: [
    // One per architecture; ${arch} picks the one matching the build.
    { from: "resources/caimex-cli-${arch}", to: "caimex-cli" },
    { from: "resources/plugins", to: "." },
  ],
  // Installed apps update from the same GitHub releases the CLI ships in.
  publish: { provider: "github", owner: "digiland", repo: "caimex-code", releaseType: "release" },
  afterPack: async (context) => {
    const resources = context.packager.getResourcesDir(context.appOutDir)
    for (const file of ["caimex-cli", "caimex-work/server.js", "caimex-voice/server.js"]) {
      const info = await stat(path.join(resources, file)).catch(() => undefined)
      if (!info?.isFile() || info.size === 0) throw new Error(`Packaged app is missing ${file}; run \`bun run stage\` first.`)
    }
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icon.icns",
    target: ["dmg", "zip"],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Caimex Code listens while voice mode is on, so you can talk to a session. Audio is sent to your Caimex gateway to be transcribed.",
    },
    ...(signed
      ? {
          hardenedRuntime: true,
          gatekeeperAssess: false,
          // Without audio-input the hardened runtime silently denies the microphone,
          // even after the person allows it.
          entitlements: "resources/entitlements.plist",
          entitlementsInherit: "resources/entitlements.plist",
          sign: async (options) => {
            const { sign } = await import("app-builder-lib/out/codeSign/macCodeSign")
            await sign(macSignOptions(options))
          },
          notarize: notarized,
        }
      : { identity: null }),
  },
  dmg: { title: "Caimex Code" },
  npmRebuild: false,
}

export default config
