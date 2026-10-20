import { NodeServices } from "@effect/platform-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn } from "bun:test"
import { Effect, FileSystem, Layer, PlatformError, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

function fixture(
  respond: (command: ChildProcess.StandardCommand) => Partial<AppProcess.RunResult> & {
    error?: AppProcess.AppProcessError
  } = () => ({}),
  name = "caimex",
  failCleanup = false,
  // The installed binary's path, for installs that aren't the npm package (e.g. install.sh's).
  executableOverride?: (root: string, home: string) => Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-updater-" })
    const execPath = process.execPath
    const modules = path.join(root, "node_modules")
    const executable = executableOverride
      ? yield* executableOverride(root, path.join(root, "home"))
      : path.join(modules, "caimex", "bin", "caimex.exe")
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "binary")
    if (!executableOverride)
      yield* fs.writeFileString(
        path.join(modules, "caimex", "package.json"),
        JSON.stringify({ name, bin: { caimex: "bin/caimex.exe" } }),
      )
    // The updater uses global fetch (GitHub's latest release); scope this replacement to each install test.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(async () => Response.json({ tag_name: "v2.3.4" }), {
            preconnect: fetch.preconnect,
          }),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    // Windows locates the installer's Git Bash through `git --exec-path`; answer it with a fixture install.
    const git = path.join(root, "Git")
    const bash = process.platform === "win32" ? path.join(git, "bin", "bash.exe") : "bash"
    if (process.platform === "win32") {
      yield* fs.makeDirectory(path.dirname(bash), { recursive: true })
      yield* fs.writeFileString(bash, "bash")
    }
    const commands: string[][] = []
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provide(
        LayerNode.compile(EffectFlock.node, {
          replacements: [Global.node.replace(Layer.succeed(Global.Service, global))],
        }),
      ),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        remove: (target, options) =>
          failCleanup && target.startsWith(global.cache)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: target,
                }),
              )
            : fs.remove(target, options),
        realPath: (input) => (input === execPath ? fs.realPath(executable) : fs.realPath(input)),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.suspend(() => {
              if (command._tag !== "StandardCommand") return Effect.die("Unexpected piped install command")
              const lookup = command.command === "git" && command.args[0] === "--exec-path"
              if (!lookup) commands.push([command.command, ...command.args])
              const result = lookup
                ? { stdout: Buffer.from(`${path.join(git, "mingw64", "libexec", "git-core")}\n`) }
                : respond(command)
              if (result.error) return Effect.fail(result.error)
              return Effect.succeed({
                command: command.command,
                exitCode: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
                ...result,
              })
            }),
          runStream: () => Stream.die("Unexpected streaming install command"),
        }),
      ),
    )
    return { updater, commands, global, fs, executable, bash }
  })
}

const windows = process.platform === "win32" ? it.live : it.live.skip
const unix = process.platform === "win32" ? it.live.skip : it.live

const installs = [
  { method: "npm", command: ["npm", "install", "--global", "--force", "caimex@2.3.4-beta.1"] },
  {
    method: "pnpm",
    command: ["pnpm", "add", "--global", "--allow-build=caimex", "caimex@2.3.4-beta.1"],
  },
  { method: "yarn", command: ["yarn", "global", "add", "caimex@2.3.4-beta.1"] },
  { method: "vp", command: ["vp", "update", "-g", "caimex@2.3.4-beta.1"] },
] as const

installs.forEach(({ method, command }) => {
  it.live(`${method} installs the explicit V2 package version without a leading v`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.updater.upgrade(method, "v2.3.4-beta.1")
      expect(test.commands).toEqual([[...command]])
    }),
  )
})

it.live("vp force-installs caimex over an upstream package that owns the binary", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli")
    yield* test.updater.upgrade("vp", "v2.3.4-beta.1")
    expect(test.commands).toEqual([["vp", "install", "-g", "--force", "caimex@2.3.4-beta.1"]])
  }),
)

it.live("vp removes the package from its managed global store", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const removal = test.updater.removal("vp")
    if (!removal) return yield* Effect.die("Expected vp removal command")
    expect(removal.command).toEqual(["vp", "uninstall", "-g", "caimex"])
    yield* removal.run
    expect(test.commands).toEqual([["vp", "uninstall", "-g", "caimex"]])
  }),
)
;[0, 1].forEach((exitCode) => {
  it.live(`bun isolates and removes its install cache after exit ${exitCode}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        expect(command.command).toBe("bun")
        expect(existsSync(command.args[4])).toBe(true)
        return { exitCode, stderr: Buffer.from("bun install failed") }
      })
      const result = yield* test.updater.upgrade("bun", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const cache = test.commands[0]?.[5]
      expect(cache).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["bun", "install", "--global", "--trust", "--cache-dir", cache, "caimex@2.3.4-beta.1"],
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(exitCode === 0 ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe("bun install failed")
    }),
  )
})

it.live("bun ignores install cache cleanup failures", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli", true)
    yield* test.updater.upgrade("bun", "v2.3.4-beta.1")
    expect(test.commands).toHaveLength(1)
  }),
)
;["success", "download", "install"].forEach((failure) => {
  it.live(`curl uses the V2 installer and cleans its directory: ${failure}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        const installer = command.args[2]
        expect(existsSync(path.dirname(installer))).toBe(true)
        return {
          exitCode: command.command === (failure === "download" ? "curl" : failure === "install" ? "env" : "") ? 1 : 0,
          stderr: Buffer.from(`${failure} failed`),
        }
      })
      const result = yield* test.updater.upgrade("curl", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const installer = test.commands[0]?.[3]
      expect(installer).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["curl", "-fsSL", "-o", installer, "https://github.com/digiland/caimex-code/releases/latest/download/install.sh"],
        ...(failure === "download" ? [] : [["env", "CAIMEXCODE_CHANNEL=v2.3.4-beta.1", "bash", installer]]),
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(failure === "success" ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe(`${failure} failed`)
    }),
  )
})

it.live("invalid version targets never execute a command or create a cache", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* Effect.forEach(Updater.methods, (method) =>
      Effect.forEach(
        ["", "latest", "2.3", "01.2.3", "vv2.3.4", "2.3.4; echo unsafe", "--global", "v2.3.4\n--force"],
        (version) =>
          Effect.gen(function* () {
            const error = yield* test.updater.upgrade(method, version).pipe(Effect.flip)
            expect(error.message).toBe(`Invalid version: ${version}`)
          }),
      ),
    )
    expect(test.commands).toEqual([])
    expect(yield* test.fs.exists(test.global.cache)).toBe(false)
  }),
)

it.live("install failures expose stderr and process errors do not report success", () =>
  Effect.gen(function* () {
    const failed = yield* fixture(() => ({ exitCode: 1, stderr: Buffer.from("  registry denied access\n") }))
    const error = yield* failed.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    const missing = yield* fixture(() => ({ error: new AppProcess.AppProcessError({ command: "npm" }) }))
    const unavailable = yield* missing.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(unavailable.message).toBe("Failed to update with npm")
    expect(failed.commands).toHaveLength(1)
    expect(missing.commands).toHaveLength(1)
  }),
)
;(["npm", "pnpm", "bun", "yarn", "vp", undefined] as const).forEach((method) => {
  it.live(`method detection identifies ${method ?? "an unknown installation"} using the V2 package`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => ({
        stdout: Buffer.from(
          command.command === method
            ? method === "vp"
              ? JSON.stringify([{ name: "caimex", version: "2.3.4" }])
              : "caimex@2.3.4"
            : command.command === "vp"
              ? "[]"
              : "opencode-ai@1.0.0",
        ),
      }))
      expect(yield* test.updater.method()).toBe(method)
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "caimex"],
        ["pnpm", "list", "-g", "--depth=0", "caimex"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
        ["vp", "list", "-g", "--json", "caimex"],
      ])
    }),
  )
})

it.live("method detection tolerates unavailable package managers", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) =>
      command.command === "yarn"
        ? { stdout: Buffer.from("caimex@2.3.4") }
        : { error: new AppProcess.AppProcessError({ command: command.command }) },
    )
    expect(yield* test.updater.method()).toBe("yarn")
    expect(test.commands).toHaveLength(5)
  }),
)

it.live("vp detection ignores no-match output that repeats the package name", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) => ({
      stdout: Buffer.from(command.command === "vp" ? "No global packages matching 'caimex'." : ""),
    }))
    expect(yield* test.updater.method()).toBeUndefined()
  }),
)

// Caimex: upstream's Homebrew tests (Core formula, anomalyco/tap) are dropped: Caimex has
// no Homebrew distribution, and releases come from GitHub and npm (see updater.ts).

const winget = (search: Partial<AppProcess.RunResult>) =>
  fixture(
    (command) => (command.args[0] === "search" ? search : {}),
    "@opencode/cli",
    false,
    "@opencode/cli",
    undefined,
    (root) =>
      Effect.succeed(
        path.join(
          root,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Anomaly.OpenCode_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "opencode.exe",
        ),
      ),
  )
const wingetArgs = [
  "--id",
  "Anomaly.OpenCode",
  "--exact",
  "--source",
  "winget",
  "--accept-source-agreements",
  "--disable-interactivity",
]

it.live("WinGet installs check, upgrade, and remove the version in the WinGet index", () =>
  Effect.gen(function* () {
    const test = yield* winget({
      stdout: Buffer.from(
        "Name     Id               Version\r\n------------------------------\r\nOpenCode Anomaly.OpenCode 2.0.28\r\n",
      ),
    })
    expect(yield* test.updater.method()).toBe("winget")
    expect(yield* test.updater.latest()).toBe("2.0.28")
    yield* test.updater.upgrade("winget", "v2.0.28")
    const removal = test.updater.removal("winget")
    if (!removal) return yield* Effect.die("Expected winget removal command")
    yield* removal.run
    expect(test.commands).toEqual([
      ["winget", "search", ...wingetArgs],
      ["winget", "upgrade", ...wingetArgs, "--version", "2.0.28", "--silent", "--accept-package-agreements"],
      ["winget", "uninstall", ...wingetArgs],
    ])
    // WinGet moderates submissions, so the OpenCode release service may list a version WinGet cannot install yet.
    expect(test.requests).toEqual([])
  }),
)

it.live("WinGet update checks report a missing package instead of a version", () =>
  Effect.gen(function* () {
    const test = yield* winget({
      exitCode: -1978335212,
      stdout: Buffer.from("No package found matching input criteria.\r\n"),
    })
    const error = yield* test.updater.latest().pipe(Effect.flip)
    expect(error.message).toBe("No package found matching input criteria.")
  }),
)

// Links are named opencode-upgrade-<pid>-<random>.exe; read them from inside the installer run.
const links = (directory: string) =>
  existsSync(directory) ? readdirSync(directory).filter((name) => name.startsWith("opencode-")) : []
const upgradeLinks = (directory: string) =>
  links(directory).filter((name) => name.startsWith(`opencode-upgrade-${process.pid}-`))

windows("windows keeps a second link to the running binary in the cache while the installer runs", () =>
  Effect.gen(function* () {
    const layout = { executable: "", cache: "" }
    const test = yield* fixture(() => {
      expect(readFileSync(layout.executable, "utf8")).toBe("binary")
      const held = upgradeLinks(layout.cache)
      expect(held).toHaveLength(1)
      expect(readFileSync(path.join(layout.cache, held[0]), "utf8")).toBe("binary")
      return {}
    })
    layout.executable = test.executable
    layout.cache = test.global.cache
    yield* test.fs.makeDirectory(test.global.cache, { recursive: true })
    // pid 999999999 does not exist; pid 4 is System, alive but not openable (EPERM).
    yield* test.fs.writeFileString(path.join(test.global.cache, "opencode-upgrade-999999999-dead.exe"), "exited")
    yield* test.fs.writeFileString(path.join(test.global.cache, "opencode-service-4-aa.exe"), "inaccessible")
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(test.commands).toHaveLength(1)
    // The installed path never disappears; the extra link is released and only dead ones are swept.
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual(["opencode-service-4-aa.exe"])
  }),
)

windows("windows releases the link when the installer fails", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(upgradeLinks(layout.cache)).toHaveLength(1)
      return { exitCode: 1, stderr: Buffer.from("registry denied access") }
    })
    layout.cache = test.global.cache
    const error = yield* test.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual([])
  }),
)

windows("windows keeps the uninstall link in the temporary directory, not the removed cache", () =>
  Effect.gen(function* () {
    const layout = { tmp: "" }
    const test = yield* fixture(() => {
      expect(upgradeLinks(layout.tmp)).toHaveLength(1)
      return {}
    })
    layout.tmp = test.global.tmp
    yield* test.fs.makeDirectory(test.global.cache, { recursive: true })
    const removal = test.updater.removal("bun")
    if (!removal) return yield* Effect.die("Expected bun removal command")
    yield* removal.run
    expect(test.commands).toEqual([["bun", "remove", "--global", "caimex"]])
    expect(links(test.global.cache)).toEqual([])
    expect(links(test.global.tmp)).toEqual([])
  }),
)

windows("windows links the curl binary before the installer replaces it", () =>
  Effect.gen(function* () {
    const layout = { executable: "", cache: "" }
    const test = yield* fixture((command) => {
      if (command.command === "env") {
        expect(readFileSync(layout.executable, "utf8")).toBe("binary")
        expect(upgradeLinks(layout.cache)).toHaveLength(1)
      }
      return {}
    })
    layout.executable = path.join(test.global.home, ".local", "bin", "caimex.exe")
    layout.cache = test.global.cache
    const original = process.execPath
    process.execPath = layout.executable
    yield* Effect.addFinalizer(() => Effect.sync(() => (process.execPath = original)))
    expect(yield* test.updater.method()).toBe("curl")
    yield* test.updater.upgrade("curl", "2.3.4")
    expect(test.commands.map((command) => command[0])).toEqual(["curl", "env"])
    expect(yield* test.fs.readFileString(layout.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual([])
  }),
)

unix("curl method detection resolves symlinked home directories", () =>
  Effect.gen(function* () {
    // Caimex: install.sh's binary is ~/.local/bin/caimex (upstream: ~/.opencode/bin/opencode).
    const test = yield* fixture(
      () => ({}),
      "caimex",
      false,
      (root, home) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const realHome = path.join(root, "real-home")
          const bin = path.join(realHome, ".local", "bin", "caimex")
          yield* fs.makeDirectory(path.dirname(bin), { recursive: true })
          yield* fs.symlink(realHome, home)
          return bin
        }),
    )
    expect(yield* test.updater.method()).toBe("curl")
    expect(test.commands).toEqual([])
  }),
)

windows("windows leaves a source checkout's runtime alone", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(links(layout.cache)).toEqual([])
      return {}
    }, "not-opencode")
    layout.cache = test.global.cache
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(test.commands).toHaveLength(1)
  }),
)

unix("other platforms never link the running binary", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(links(layout.cache)).toEqual([])
      return {}
    })
    layout.cache = test.global.cache
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
  }),
)
