import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { app } from "electron"

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))
const stateHome = process.env.XDG_STATE_HOME
const desktopStateNames = [
  "ai.opencode.desktop.dev",
  "ai.opencode.desktop.beta",
  "ai.opencode.desktop",
  "zw.co.econetai.caimex.desktop.dev",
  "zw.co.econetai.caimex.desktop.beta",
  "zw.co.econetai.caimex.desktop",
]

type Logger = {
  log(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

const CAIMEX_CONFIG = JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  enabled_providers: ["caimex"],
  provider: {
    caimex: {
      npm: "@ai-sdk/openai-compatible",
      name: "Caimex Gateway",
      options: { baseURL: "https://caimex.econetai.co.zw:2052/v1" },
    },
  },
  compaction: { auto: true, prune: true, reserved: 160000 },
})

export async function startBackgroundCli(logger: Logger, shellStateHome?: string) {
  const overridden = process.env.OPENCODE_V2_CLI_PATH
  const bundled = overridden ?? (app.isPackaged
    ? join(process.resourcesPath, executableName())
    : join(root, "../../resources", executableName()))
  logger.log("v2 CLI executable resolved", { bundled, packaged: app.isPackaged, overridden: Boolean(overridden) })
  const version = await run(bundled, ["--version"], logger)
  const binary = overridden || !app.isPackaged ? bundled : await installCli(bundled, version, logger)

  const candidates = [
    ...new Set([stateHome, shellStateHome, ...desktopStateNames.map((name) => join(app.getPath("appData"), name))]),
  ].filter((candidate) => candidate === undefined || existsSync(candidate))
  const discovered = await Promise.all(
    candidates.map(async (candidate) => ({
      stateHome: candidate,
      url: serviceUrl(await run(binary, ["service", "status"], logger, { stateHome: candidate })),
    })),
  )
  const found = discovered.find((candidate) => candidate.url !== undefined)
  logger.log("v2 CLI background instance checked", {
    detected: Boolean(found),
    ...endpoint(found?.url),
  })

  const daemonStateHome = found?.stateHome ?? stateHome
  const url = await run(binary, ["service", "start"], logger, { stateHome: daemonStateHome })
  const password = await servicePassword(binary, logger, daemonStateHome)
  logger.log("v2 CLI background service ready", {
    existing: Boolean(found),
    username: "opencode",
    ...endpoint(url),
  })
  return {
    url,
    // The v2 server defaults its basic-auth username to "opencode"
    // (OPENCODE_SERVER_USERNAME); the password is the real secret.
    username: "opencode",
    password,
  }
}

// Reading the daemon password is spelled differently by different CLI
// generations: upstream's published binary groups it under `service get`, while
// this fork's v2 source exposes a bare `service password`. Neither is wrong, and
// the desktop has to drive whichever binary it was pointed at — so try the newer
// form and fall back rather than pinning to one.
//
// The first attempt failing is an expected outcome, not an error, so it logs
// quietly; only exhausting every form throws.
const PASSWORD_COMMANDS = [
  ["service", "get", "password"],
  ["service", "password"],
]

async function servicePassword(binary: string, logger: Logger, stateHome?: string) {
  let last: unknown
  for (const [index, args] of PASSWORD_COMMANDS.entries()) {
    try {
      const password = await run(binary, args, logger, { redact: true, stateHome, quiet: true })
      if (password) return password
      last = new Error(`\`${args.join(" ")}\` returned no password`)
    } catch (error) {
      last = error
    }
    if (index < PASSWORD_COMMANDS.length - 1) {
      logger.log("v2 CLI password command not supported, trying next form", { args })
    }
  }
  logger.error("v2 CLI password command failed", {
    error: last instanceof Error ? last.message : String(last),
  })
  throw last
}

async function installCli(source: string, version: string, logger: Logger) {
  const directory = join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = join(directory, executableName())
  if (existsSync(destination)) {
    logger.log("v2 CLI staged executable reused", { path: destination, version })
    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await copyFile(source, temp)
  if (process.platform !== "win32") await chmod(temp, 0o755)
  await rename(temp, destination).catch(async (error) => {
    await rm(temp, { force: true })
    throw error
  })
  logger.log("v2 CLI executable staged", { source, path: destination, version })
  return destination
}

async function run(
  binary: string,
  args: string[],
  logger: Logger,
  options: { redact?: boolean; stateHome?: string; quiet?: boolean } = {},
) {
  logger.log("v2 CLI command started", { binary, args })
  const env = { ...process.env }
  if (options.stateHome === undefined) delete env.XDG_STATE_HOME
  else env.XDG_STATE_HOME = options.stateHome
  return execFileAsync(binary, args, { env, windowsHide: true }).then(
    (result) => {
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()
      logger.log("v2 CLI command completed", { args, stdout: options.redact ? "[redacted]" : stdout, stderr })
      return stdout
    },
    (error: unknown) => {
      const output = error as { stdout?: string; stderr?: string }
      const report = options.quiet ? logger.log : logger.error
      report.call(logger, "v2 CLI command failed", {
        args,
        error: error instanceof Error ? error.message : String(error),
        stdout: options.redact && output.stdout ? "[redacted]" : (output.stdout?.trim() ?? ""),
        stderr: output.stderr?.trim() ?? "",
      })
      throw error
    },
  )
}

function serviceUrl(status: string) {
  if (URL.canParse(status)) return status
  if (!status.startsWith("running ")) return
  const url = status.slice("running ".length).trim()
  return URL.canParse(url) ? url : undefined
}

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}

function executableName() {
  return process.platform === "win32" ? "caimex-cli.exe" : "caimex-cli"
}
