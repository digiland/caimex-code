import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } from "electron"
import { connect } from "./daemon"

// Set before ready so userData, the single-instance lock and the Dock label are this
// app's own. Dev runs get a separate name so they never contend with an installed build.
app.setName(app.isPackaged ? "Caimex Code" : "Caimex Code Dev")

if (!app.requestSingleInstanceLock()) app.quit()

// Packaged builds serve the UI from oc://renderer rather than file://. The daemon's CORS
// already allows that origin (it's what the other desktop app uses), and file:// is not.
const RENDERER = { scheme: "oc", host: "renderer" }
const rendererRoot = join(import.meta.dirname, "../renderer")
protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER.scheme, privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
])

function serveRenderer() {
  protocol.handle(RENDERER.scheme, (request) => {
    const url = new URL(request.url)
    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const inside = relative(rendererRoot, file)
    if (url.host !== RENDERER.host || inside.startsWith("..") || isAbsolute(inside))
      return new Response("Not found", { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

// Dev builds expose DevTools on localhost so the window can be inspected and
// screenshotted from scripts. Never in a packaged app.
if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", process.env.CAIMEX_DEBUG_PORT ?? "9333")

let window: BrowserWindow | undefined

function createWindow() {
  window = new BrowserWindow({
    title: "Caimex Code",
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#141416",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once("ready-to-show", () => window?.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadURL(`${RENDERER.scheme}://${RENDERER.host}/index.html`)
}

ipcMain.handle("daemon:connect", () => connect())
ipcMain.handle("dialog:folder", async () => {
  if (!window) return undefined
  const result = await dialog.showOpenDialog(window, {
    title: "Choose a project folder",
    properties: ["openDirectory", "createDirectory"],
  })
  return result.canceled ? undefined : result.filePaths[0]
})
// Only web links leave the app; anything else a renderer asks to open is refused.
ipcMain.handle("shell:open", (_event, url: unknown) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url)
})
ipcMain.handle("app:info", () => ({ version: app.getVersion(), packaged: app.isPackaged }))
ipcMain.handle("fs:exists", (_event, path: unknown) => typeof path === "string" && isAbsolute(path) && existsSync(path))

app.on("second-instance", () => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

void app.whenReady().then(() => {
  serveRenderer()
  // A packaged app takes its icon from the bundle; only a dev run needs one set.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), "..", "desktop", "icons", "prod", "dock.png"))
    if (!icon.isEmpty()) app.dock?.setIcon(icon)
  }
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
