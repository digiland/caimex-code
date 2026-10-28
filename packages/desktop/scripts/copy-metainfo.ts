import { resolveChannel } from "./utils"
import { APP_IDS, APP_NAMES, GITHUB_OWNER, GITHUB_REPO, HOMEPAGE } from "../src/branding"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = APP_IDS[channel]
const productName = APP_NAMES[channel]
const summary = `AI coding agent for the Caimex gateway${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="${GITHUB_OWNER}">
    <name>${GITHUB_OWNER}</name>
  </developer>

  <description>
    <p>
      Caimex Code is an AI agent that helps you write and run code, with every model served through the Caimex gateway.
      It is a fork of OpenCode and is not affiliated with the OpenCode team.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues</url>
  <url type="homepage">${HOMEPAGE}</url>
  <url type="vcs-browser">https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
