#!/usr/bin/env bun
// build-caimex.ts: Caimex release archives from upstream's CLI build.
//
// Runs script/build.ts (which names the binary `caimex`), then packages each
// dist/cli-<target>/bin as caimex-<target>.{tar.gz,zip} with a .sha256 sidecar and
// one SHA256SUMS, in packages/caimex/ at the repo root. That layout, and the archive
// names, are what install.sh and npm/caimex/install.mjs download, and they match the
// v1 releases, so `caimex upgrade` on a v1 install lands on this build.
//
// Flags pass through to build.ts (e.g. --single for a native-only build).
import { $ } from "bun"
import fs from "fs"
import path from "path"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

await $`bun run ./script/build.ts ${process.argv.slice(2)}`

const outDir = path.resolve(dir, "../caimex")
await $`rm -rf ${outDir}`
await $`mkdir -p ${outDir}`

const targets = fs
  .readdirSync("dist", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("cli-"))
  .map((entry) => entry.name.slice("cli-".length))
if (targets.length === 0) throw new Error("no cli-* targets in dist/; did build.ts fail?")

for (const target of targets) {
  const binDir = path.join("dist", `cli-${target}`, "bin")
  const binary = target.startsWith("windows") ? "caimex.exe" : "caimex"
  if (!fs.existsSync(path.join(binDir, binary))) throw new Error(`missing ${binary} for ${target}`)

  const ext = target.startsWith("linux") ? "tar.gz" : "zip"
  const archive = `caimex-${target}.${ext}`
  const archivePath = path.join(outDir, archive)
  console.log(`packaging ${archive}`)
  if (ext === "tar.gz") await $`tar -czf ${archivePath} *`.cwd(binDir)
  else await $`zip -qr ${archivePath} *`.cwd(binDir)

  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(archivePath).bytes()).digest("hex")
  // `sha256sum -c` format: two spaces between hash and file name.
  await Bun.write(`${archivePath}.sha256`, `${hash}  ${archive}\n`)
}

const sums = fs
  .readdirSync(outDir)
  .filter((file) => file.endsWith(".sha256"))
  .sort()
  .map((file) => fs.readFileSync(path.join(outDir, file), "utf8"))
  .join("")
await Bun.write(path.join(outDir, "SHA256SUMS"), sums)

console.log(`\ndone, archives in ${outDir}:`)
for (const file of fs.readdirSync(outDir).sort()) console.log(`  ${file}`)
