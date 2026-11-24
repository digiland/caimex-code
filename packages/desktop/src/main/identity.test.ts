import { expect, test } from "bun:test"
import { isCollidingDevShortcut, resolveIdentity } from "./identity"

test.each([
  {
    channel: "dev",
    packaged: true,
    appName: "Caimex Desktop Dev",
    appID: "zw.co.econetai.caimexdesktop.dev",
    appUserModelID: "zw.co.econetai.caimexdesktop.dev",
  },
  {
    channel: "beta",
    packaged: true,
    appName: "Caimex Desktop Beta",
    appID: "zw.co.econetai.caimexdesktop.beta",
    appUserModelID: "zw.co.econetai.caimexdesktop.beta",
  },
  {
    channel: "prod",
    packaged: true,
    appName: "Caimex Desktop",
    appID: "zw.co.econetai.caimexdesktop",
    appUserModelID: "zw.co.econetai.caimexdesktop",
  },
  {
    channel: "local",
    packaged: false,
    appName: "Caimex Desktop Dev",
    appID: "zw.co.econetai.caimexdesktop.dev",
    appUserModelID: "zw.co.econetai.caimexdesktop.local",
  },
  {
    channel: "dev",
    packaged: false,
    appName: "Caimex Desktop Dev",
    appID: "zw.co.econetai.caimexdesktop.dev",
    appUserModelID: "zw.co.econetai.caimexdesktop.local",
  },
] as const)(
  "identity for $channel (packaged=$packaged) isolates unpackaged AUMID from installed channels",
  ({ channel, packaged, appName, appID, appUserModelID }) => {
    expect(resolveIdentity(channel, packaged)).toEqual({ appName, appID, appUserModelID })
  },
)

const installedExe = "C:\\Users\\user\\AppData\\Local\\Programs\\zw.co.econetai.caimexdesktop.dev\\Caimex Desktop Dev.exe"

const devElectron = "D:\\repo\\node_modules\\electron\\dist\\electron.exe"

test.each([
  {
    name: "unpackaged Electron.lnk claiming the installed dev AUMID",
    shortcut: { appUserModelId: "zw.co.econetai.caimexdesktop.dev", target: devElectron },
    expected: true,
  },
  {
    name: "case-insensitive AUMID match",
    shortcut: { appUserModelId: "ZW.CO.EconetAI.CaimexDesktop.Dev", target: devElectron },
    expected: true,
  },
  {
    name: "unpackaged Electron.lnk with the isolated local AUMID",
    shortcut: { appUserModelId: "zw.co.econetai.caimexdesktop.local", target: devElectron },
    expected: false,
  },
  {
    name: "unrelated app shortcut",
    shortcut: { appUserModelId: "com.example.other", target: devElectron },
    expected: false,
  },
  {
    name: "shortcut without an AUMID",
    shortcut: { target: devElectron },
    expected: false,
  },
  {
    name: "shortcut targeting the installed executable itself",
    shortcut: { appUserModelId: "zw.co.econetai.caimexdesktop.dev", target: installedExe.toLowerCase() },
    expected: false,
  },
])("isCollidingDevShortcut returns $expected for $name", ({ shortcut, expected }) => {
  expect(isCollidingDevShortcut(shortcut, "zw.co.econetai.caimexdesktop.dev", installedExe)).toBe(expected)
})
