#!/usr/bin/env bun
// Stages what a packaged Caimex Code carries besides its own code, under resources/:
//
//   caimex-cli-arm64, caimex-cli-x64   the daemon (the v2 CLI), one per Mac architecture;
//                                      electron-builder picks the one matching each build
//   plugins/caimex-work, caimex-voice  the work modes and voice, each bundled to a single
//                                      file, in a folder the daemon loads as a plugin
//
// The CLI binaries come from packages/cli builds, one --outdir per target:
//   bun run script/build.ts --target=opencode-darwin-arm64 --outdir=dist-mac-arm64
//   bun run script/build.ts --target=opencode-darwin-x64 --outdir=dist-mac-x64
// or from --cli-arm64=<file> / --cli-x64=<file>. --arch=arm64 stages only one (a local
// build for this Mac).
import { $ } from "bun"
import { chmod, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const app = path.resolve(import.meta.dirname, "..")
const packages = path.resolve(app, "..")
const resources = path.join(app, "resources")
const flag = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

const arches = flag("arch") ? [flag("arch")!] : ["arm64", "x64"]
for (const arch of arches) {
  const source =
    flag(`cli-${arch}`) ?? path.join(packages, "cli", `dist-mac-${arch}`, `cli-darwin-${arch}`, "bin", "caimex")
  if (!existsSync(source))
    throw new Error(
      `No caimex CLI for ${arch} at ${source}. Build it in packages/cli with ` +
        `\`bun run script/build.ts --target=opencode-darwin-${arch} --outdir=dist-mac-${arch}\`, or pass --cli-${arch}=<file>.`,
    )
  const dest = path.join(resources, `caimex-cli-${arch}`)
  await copyFile(source, dest)
  await chmod(dest, 0o755)
  console.log(`staged ${path.relative(app, dest)} from ${source}`)
}

// A plugin folder resolves its `server` entry (and `rpc`, if any); the bundles keep the
// layout their code expects (caimex-work finds skills/ beside dist/).
const plugins = path.join(resources, "plugins")
await rm(plugins, { recursive: true, force: true })

const work = path.join(plugins, "caimex-work")
await $`bun run build`.cwd(path.join(packages, "caimex-work"))
await mkdir(path.join(work, "dist"), { recursive: true })
await copyFile(path.join(packages, "caimex-work", "dist", "index.js"), path.join(work, "dist", "index.js"))
await cp(path.join(packages, "caimex-work", "skills"), path.join(work, "skills"), { recursive: true })
await writeFile(path.join(work, "server.js"), 'export { default } from "./dist/index.js"\n')

const voice = path.join(plugins, "caimex-voice")
await $`bun build server.ts --target bun --outfile ${path.join(voice, "dist", "index.js")}`.cwd(
  path.join(packages, "caimex-voice"),
)
await $`bun build rpc.ts --target bun --outfile ${path.join(voice, "dist", "rpc.js")}`.cwd(
  path.join(packages, "caimex-voice"),
)
await writeFile(path.join(voice, "server.js"), 'export { default } from "./dist/index.js"\n')
await writeFile(path.join(voice, "rpc.js"), 'export * from "./dist/rpc.js"\n')

console.log(`staged plugins in ${path.relative(app, plugins)}`)
