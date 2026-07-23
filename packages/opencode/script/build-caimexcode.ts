#!/usr/bin/env bun
// build-caimexcode.ts — build caimexcode release archives from the upstream build.
//
// Runs upstream script/build.ts (untouched, so upstream merges stay clean), then
// repackages dist/opencode-* outputs as caimexcode-<os>-<arch>[-variant] archives
// with the binary renamed to `caimexcode`, plus .sha256 sidecars, into
// packages/caimexcode/ at the repo root — the layout upload-caimexcode.sh and
// install.sh expect (linux → .tar.gz, darwin/windows → .zip, binary at archive root).
//
// Flags are passed through to build.ts (e.g. --single for a native-only build).
import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(dir)

const passthrough = process.argv.slice(2)

// OPENCODE_RELEASE would make build.ts archive under upstream naming and push to a
// GitHub release itself — archiving is handled here instead.
const env = { ...process.env }
delete env.OPENCODE_RELEASE

await $`bun run ./script/build.ts ${passthrough}`.env(env)

const outDir = path.resolve(dir, "../caimexcode")
await $`rm -rf ${outDir}`
await $`mkdir -p ${outDir}`

const distDirs = fs
  .readdirSync("dist", { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("opencode-"))
  .map((d) => d.name)

if (distDirs.length === 0) {
  console.error("no opencode-* targets found in dist/ — did build.ts fail?")
  process.exit(1)
}

for (const name of distDirs) {
  const target = name.replace(/^opencode-/, "") // e.g. linux-x64, windows-arm64, linux-x64-musl
  const binDir = path.join("dist", name, "bin")
  const isWindows = target.startsWith("windows")

  const src = path.join(binDir, isWindows ? "opencode.exe" : "opencode")
  const dest = path.join(binDir, isWindows ? "caimexcode.exe" : "caimexcode")
  if (!fs.existsSync(src)) {
    if (!fs.existsSync(dest)) {
      console.error(`missing binary for ${name}: ${src}`)
      process.exit(1)
    }
  } else {
    fs.renameSync(src, dest)
  }

  const ext = target.startsWith("linux") ? "tar.gz" : "zip"
  const archive = `caimexcode-${target}.${ext}`
  const archivePath = path.join(outDir, archive)

  console.log(`packaging ${archive}`)
  if (ext === "tar.gz") {
    await $`tar -czf ${archivePath} *`.cwd(binDir)
  } else {
    await $`zip -qr ${archivePath} *`.cwd(binDir)
  }

  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(archivePath).bytes()).digest("hex")
  // "sha256sum -c"-compatible: two spaces between hash and bare filename
  await Bun.file(`${archivePath}.sha256`).write(`${hash}  ${archive}\n`)
}

// One aggregate manifest for installers to verify against
const sums = fs
  .readdirSync(outDir)
  .filter((f) => f.endsWith(".sha256"))
  .sort()
  .map((f) => fs.readFileSync(path.join(outDir, f), "utf8"))
  .join("")
await Bun.file(path.join(outDir, "SHA256SUMS")).write(sums)

console.log(`\ndone — archives in ${outDir}:`)
for (const f of fs.readdirSync(outDir).sort()) console.log(`  ${f}`)
