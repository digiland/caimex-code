import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"

const exec = promisify(execFile)

export type Connection =
  | { ok: true; url: string; username: string; password: string }
  | { ok: false; error: string }

// The daemon is the v2 CLI built from this repo (packages/cli). The existing desktop
// app stages it under packages/desktop/resources; share that binary and, through
// `service start`, the same running daemon and session database.
function binary() {
  const override = process.env.CAIMEX_CLI_PATH
  if (override) return override
  if (app.isPackaged) return join(process.resourcesPath, "caimex-cli")
  return join(app.getAppPath(), "..", "desktop", "resources", "caimex-cli")
}

async function run(path: string, args: string[]) {
  const { stdout } = await exec(path, args, { windowsHide: true, timeout: 30_000 })
  return stdout.trim()
}

// This fork's CLI spells it `service password`; upstream's published one groups it
// under `service get`.
async function password(path: string) {
  for (const args of [["service", "password"], ["service", "get", "password"]]) {
    const value = await run(path, args).catch(() => "")
    if (value) return value
  }
  throw new Error("The daemon did not return a password")
}

export async function connect(): Promise<Connection> {
  const path = binary()
  if (!existsSync(path))
    return {
      ok: false,
      error: `Daemon binary not found at ${path}. Build it with \`bun run dev\` in packages/desktop once, or set CAIMEX_CLI_PATH.`,
    }
  try {
    const url = (await run(path, ["service", "start"])).split(/\s+/).find((part) => part.startsWith("http"))
    if (!url) throw new Error("`service start` did not print a URL")
    return { ok: true, url: url.replace(/\/$/, ""), username: "opencode", password: await password(path) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
