import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const channels = [
  { channel: "dev", appId: "zw.co.econetai.caimex.desktop.dev", productName: "Caimex Code Dev" },
  { channel: "beta", appId: "zw.co.econetai.caimex.desktop.beta", productName: "Caimex Code Beta" },
  { channel: "prod", appId: "zw.co.econetai.caimex.desktop", productName: "Caimex Code" },
] as const

async function load(channel: string, tag: string) {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = channel
  const module = await import(`./electron-builder.config.ts?${tag}=${channel}`)
  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous
  return module.default as Configuration
}

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const config = await load(channel.channel, "identity")

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toBe(channel.productName)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

for (const channel of channels) {
  test(`registers the caimex:// scheme for ${channel.channel}`, async () => {
    const config = await load(channel.channel, "scheme")
    const protocols = Array.isArray(config.protocols) ? config.protocols : [config.protocols]
    expect(protocols.flatMap((item) => item?.schemes ?? [])).toEqual(["caimex"])
  })
}

test("prod publishes updates to the Caimex repo", async () => {
  const config = await load("prod", "publish")
  expect(config.publish).toEqual({ provider: "github", owner: "digiland", repo: "caimex-code", channel: "latest" })
  expect(config.artifactName).toStartWith("caimex-desktop-")
})

for (const channel of ["dev", "beta"] as const) {
  test(`${channel} publishes no update metadata`, async () => {
    const config = await load(channel, "no-publish")
    expect(config.publish).toBeNull()
  })
}

test("bundles the CLI outside the dev app archive", async () => {
  const config = await load("dev", "cli-resource")

  expect(config.files).toContain("!resources/opencode-cli*")
  expect(config.extraResources).toContainEqual({
    from: "resources/",
    to: "",
    filter: ["opencode-cli*"],
  })
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const config = await load(channel, "no-cli-resource")

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    })
  })
}
