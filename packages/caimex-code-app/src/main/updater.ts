// Keeps an installed app current from the GitHub releases the CLI ships in (the feed is
// `publish` in electron-builder.config.ts). An update downloads in the background and
// installs when the app quits; the window offers to restart for it sooner.
//
// Only a packaged, signed app can update itself (macOS checks the new copy's signature
// against this one), so dev runs never check and unsigned builds just log the failure.
import { app, type BrowserWindow, ipcMain } from "electron"
import electronUpdater from "electron-updater"

const { autoUpdater } = electronUpdater

const HOURS = 60 * 60 * 1000

export function registerUpdates(window: () => BrowserWindow | undefined) {
  let ready: { version: string } | undefined
  ipcMain.handle("update:state", () => ready)
  ipcMain.handle("update:install", () => {
    if (ready) autoUpdater.quitAndInstall()
  })
  if (!app.isPackaged || process.env.CAIMEX_NO_UPDATES) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on("update-downloaded", (info) => {
    ready = { version: info.version }
    const win = window()
    if (win && !win.isDestroyed()) win.webContents.send("update:ready", ready)
  })
  // Its own logger prints whole HTTP responses; one line says enough (a release without
  // a Mac build, for one, is a 404 here until the next one).
  autoUpdater.logger = null
  autoUpdater.on("error", (error) => console.warn("[update]", error.message.split("\n")[0]))

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined)
  check()
  setInterval(check, 4 * HOURS).unref()
}
