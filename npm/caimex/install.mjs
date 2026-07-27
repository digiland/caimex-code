// Downloads the caimex binary for this platform from GitHub Releases.
// Runs as the package's postinstall; the version downloaded always matches
// the package version, so `npm i -g caimex@x.y.z` is reproducible.
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pkgDir = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"))
const repo = process.env.CAIMEXCODE_GITHUB_REPO || "digiland/caimex-code"

const plat = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform]
const arch = { arm64: "arm64", x64: "x64" }[process.arch]
if (!plat || !arch) {
  console.error(`caimex: unsupported platform ${process.platform}-${process.arch}`)
  process.exit(1)
}

// Linux binaries are glibc; musl users can point CAIMEXCODE_TARGET at e.g. linux-x64-musl.
const target = process.env.CAIMEXCODE_TARGET || `${plat}-${arch}`
const ext = target.startsWith("linux") ? "tar.gz" : "zip"
const archive = `caimex-${target}.${ext}`
const url = `https://github.com/${repo}/releases/download/v${pkg.version}/${archive}`

const binDir = path.join(pkgDir, "bin")
const binName = plat === "windows" ? "caimex.exe" : "caimex"

console.log(`caimex: downloading ${url}`)
const res = await fetch(url, { redirect: "follow" })
if (!res.ok) {
  console.error(`caimex: download failed (HTTP ${res.status}) — ${url}`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "caimex-"))
try {
  const archivePath = path.join(tmp, archive)
  const bytes = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(archivePath, bytes)

  // Verify against the release's SHA256SUMS before we execute anything from the
  // archive. The sums file is published by the same release job that builds the
  // binaries, so a tampered asset fails here rather than landing on PATH.
  const sumsUrl = `https://github.com/${repo}/releases/download/v${pkg.version}/SHA256SUMS`
  const sumsRes = await fetch(sumsUrl, { redirect: "follow" })
  if (!sumsRes.ok) {
    console.error(`caimex: could not fetch SHA256SUMS (HTTP ${sumsRes.status}) — refusing to install unverified binary`)
    process.exit(1)
  }
  const expected = (await sumsRes.text())
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archive)?.[0]
  if (!expected) {
    console.error(`caimex: no checksum for ${archive} in SHA256SUMS — refusing to install unverified binary`)
    process.exit(1)
  }
  const actual = crypto.createHash("sha256").update(bytes).digest("hex")
  if (actual !== expected) {
    console.error(`caimex: checksum mismatch for ${archive}\n  expected ${expected}\n  actual   ${actual}`)
    process.exit(1)
  }

  if (ext === "tar.gz") {
    execFileSync("tar", ["-xzf", archivePath, "-C", tmp])
  } else if (plat === "windows") {
    // bsdtar ships with Windows 10+ and extracts zip archives
    execFileSync("tar", ["-xf", archivePath, "-C", tmp])
  } else {
    execFileSync("unzip", ["-qo", archivePath, "-d", tmp])
  }

  const extracted = path.join(tmp, binName)
  if (!fs.existsSync(extracted)) {
    console.error(`caimex: binary ${binName} not found in ${archive}`)
    process.exit(1)
  }
  // The bin entry is bin/caimex.exe on every platform (upstream's trick):
  // Windows requires the .exe suffix and Unix doesn't care about the name.
  fs.mkdirSync(binDir, { recursive: true })
  const dest = path.join(binDir, "caimex.exe")
  fs.copyFileSync(extracted, dest)
  fs.chmodSync(dest, 0o755)
  console.log("caimex: installed")
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
