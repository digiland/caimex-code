import { $ } from "bun"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI_VERSION = "0.0.0-next-16350"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export const CLI_BINARIES: Array<{ rustTarget: string; package: string; os: string; cpu: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    package: "@opencode-ai/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    package: "@opencode-ai/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    package: "@opencode-ai/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    package: "@opencode-ai/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.rustTarget === target)
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

// ── The fork's own v2 CLI ───────────────────────────────────────────────────
// The desktop's v2 backend is a separate CLI binary, not the sidecar: see
// startBackgroundCli in src/main/background-cli.ts. downloadCliToResources
// below fetches upstream's published build, which carries no Caimex code at
// all — a desktop pointed at it can never reach the gateway. So the fork
// builds its own from packages/cli, which does include CaimexPlugin.
//
// `caimex2` is only the command name compiled into the binary (see
// packages/cli/script/build.ts). The file keeps upstream's `opencode-cli`
// resource name, because background-cli.ts and electron-builder.config.ts both
// resolve it by that name — renaming it is a distribution change, not this one.
const CLI_BINARY = "caimex2"

// Workspaces whose sources are compiled into the CLI. Used only to decide
// whether the existing binary is stale: a 90MB Bun compile on every `bun run
// dev` is not worth paying, and a silently stale binary is exactly how this
// went wrong before — the desktop ran a build predating the Caimex plugin's
// fixes and nothing said so.
const CLI_SOURCES = ["cli", "core", "server", "tui", "llm", "protocol", "schema", "plugin"]

export async function buildCliToResources() {
  const target = RUST_TARGET ?? nativeTarget()
  if (target !== nativeTarget()) {
    // packages/cli's build script selects targets with --single (native) or
    // builds all twelve. Cross-building one named target is a packaging
    // concern; fail loudly rather than quietly shipping upstream's binary.
    throw new Error(
      `Cannot build the Caimex v2 CLI for '${target}' from a ${nativeTarget()} host — cross-target builds are not wired up yet`,
    )
  }

  const dest = windowsify("resources/opencode-cli")
  const built = join("..", "cli", "dist", `cli-${cliDistTarget()}`, "bin", CLI_BINARY)
  if (await isFresh(dest)) {
    console.log(`Reusing ${dest} (newer than the CLI sources)`)
    return
  }

  console.log(`Building ${CLI_BINARY} for ${target}`)
  // packages/cli's build re-resolves @opentui/core for every platform first, so
  // it reaches GitHub on every run and fails the whole build when GitHub is
  // having a moment (a 504 on the ghostty-web tarball is what prompted this).
  // Those deps only change when the CLI's own dependencies do, so on failure
  // retry once against what is already installed rather than losing the build
  // to someone else's outage. A genuine compile error fails both attempts.
  const env = { ...process.env, OPENCODE_CLI_BINARY: CLI_BINARY }
  await $`bun run build --single`
    .cwd("../cli")
    .env(env)
    .catch(async (error: unknown) => {
      console.warn(`Build failed, retrying without the dependency refresh: ${error}`)
      await $`bun run build --single --skip-install`.cwd("../cli").env(env)
    })
  await copyFile(built, dest)
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${built} to ${dest}`)
}

function cliDistTarget() {
  const { platform, arch } = process
  return `${platform === "win32" ? "windows" : platform}-${arch}`
}

// Fresh means: the staged binary exists and is newer than every source file
// that compiles into it. Mtimes, not hashes — this only has to catch "you
// edited the plugin and forgot to rebuild", which is the failure that matters.
async function isFresh(dest: string) {
  if (!existsSync(dest)) return false
  const staged = (await stat(dest)).mtimeMs
  for (const pkg of CLI_SOURCES) {
    const root = join("..", pkg, "src")
    if (!existsSync(root)) continue
    for await (const file of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true })) {
      if ((await stat(join(root, file))).mtimeMs > staged) return false
    }
  }
  return true
}

export async function downloadCliToResources() {
  const cli = getCurrentCli()
  const directory = await mkdtemp(join(tmpdir(), "opencode-cli-"))
  const dest = windowsify("resources/opencode-cli")
  try {
    await $`bun install --no-save --cwd ${directory} ${`${cli.package}@${CLI_VERSION}`} ${`--os=${cli.os}`} ${`--cpu=${cli.cpu}`}`
    await copyFile(
      join(directory, "node_modules", cli.package, "bin", cli.os === "win32" ? "opencode2.exe" : "opencode2"),
      dest,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  if (process.platform !== "win32") await chmod(dest, 0o755)
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${cli.package} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
