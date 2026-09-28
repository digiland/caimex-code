import { constants, copyFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import path from "node:path"
import { OPENCODE_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.OPENCODE_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
      ? "opencode.db"
      : `opencode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}

// Caimex: the v1 CLI kept its database under its own app id ("caimex-code"). Upstream's
// 2.x opens a v1 database in place and migrates it (sessions, and credentials from
// auth.json), so a v1 user's first start copies that database here and lets the same
// migrations run on the copy. The v1 files are left as they were. On APFS the copy is a
// clone, so even a large database costs nothing up front.
export function adoptV1Database(data: string, target: string) {
  if (process.env.OPENCODE_DB || path.basename(target) !== "opencode.db" || existsSync(target)) return
  const source = path.join(path.dirname(data), "caimex-code", "opencode.db")
  if (!existsSync(source) || statSync(source).size === 0) return
  const clone = (from: string, to: string) => copyFileSync(from, to, constants.COPYFILE_FICLONE)
  mkdirSync(path.dirname(target), { recursive: true })
  // Database first, then its WAL (the latest writes): if v1 checkpoints in between, the
  // copied WAL is from a later generation and SQLite ignores it rather than replaying
  // stale frames. The shared-memory index is rebuilt on open.
  clone(source, `${target}.adopting`)
  if (existsSync(`${source}-wal`)) clone(`${source}-wal`, `${target}-wal`)
  renameSync(`${target}.adopting`, target)
}
