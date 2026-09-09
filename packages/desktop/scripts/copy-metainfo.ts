import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "zw.co.econetai.caimex.desktop" : `zw.co.econetai.caimex.desktop.${channel}`
const productName =
  channel === "prod" ? "Caimex Code" : `Caimex Code ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `AI coding agent for the Caimex gateway${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="zw.co.econetai">
    <name>Econet AI</name>
  </developer>

  <description>
    <p>
      Caimex Code is an agent that helps you write and run code, with every model served
      through the Caimex gateway.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/digiland/caimex-code/issues</url>
  <url type="homepage">https://caimex.econetai.co.zw</url>
  <url type="vcs-browser">https://github.com/digiland/caimex-code</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
