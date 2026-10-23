// The app's side of the agent's browser: IPC between the window and the host.
import { type BrowserWindow, ipcMain } from "electron"
import { createEmbeds, type Rect } from "./embeds"
import { createBrowserHost, type Connection } from "./host"

export function registerBrowser(window: () => BrowserWindow | undefined, connection: () => Connection | undefined) {
  const { embeds, layout, hideAll } = createEmbeds()
  const host = createBrowserHost({
    connection,
    embeds,
    emit: (event) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send("browser:event", event)
    },
  })
  const text = (value: unknown) => (typeof value === "string" ? value : "")

  ipcMain.handle("browser:attach", (_event, sessionID: unknown, directory: unknown) => {
    const win = window()
    if (!win || !text(sessionID) || !text(directory)) return
    return host.attach(win, text(sessionID), text(directory))
  })
  ipcMain.handle("browser:detach", (_event, sessionID: unknown) => host.detach(text(sessionID)))
  ipcMain.handle("browser:state", (_event, sessionID: unknown) => host.state(text(sessionID)))
  ipcMain.handle("browser:open", (_event, sessionID: unknown, url: unknown) => host.open(text(sessionID), text(url)))
  ipcMain.handle("browser:navigate", (_event, sessionID: unknown, tabID: unknown, url: unknown) =>
    host.navigate(text(sessionID), text(tabID), text(url)),
  )
  ipcMain.handle("browser:go", (_event, sessionID: unknown, tabID: unknown, direction: unknown) => {
    if (direction === "back" || direction === "forward" || direction === "reload")
      return host.go(text(sessionID), text(tabID), direction)
  })
  ipcMain.handle("browser:focus", (_event, sessionID: unknown, tabID: unknown) => host.focus(text(sessionID), text(tabID)))
  ipcMain.handle("browser:close", (_event, sessionID: unknown, tabID: unknown) =>
    host.closeTab(text(sessionID), text(tabID)),
  )
  // Sent, not invoked: layout follows every resize and should never queue behind a reply.
  ipcMain.on("browser:layout", (_event, embed: unknown, rect: unknown) => {
    const r = rect as Rect | null
    layout(text(embed), r && [r.x, r.y, r.width, r.height].every(Number.isFinite) ? r : null)
  })
  // A page's native view keeps keyboard focus once clicked; typing in the app's own
  // fields (the address bar) needs it handed back first.
  ipcMain.on("browser:focus-app", () => {
    const win = window()
    if (win && !win.isDestroyed() && !win.webContents.isFocused()) win.webContents.focus()
  })
  ipcMain.on("browser:hide-all", () => {
    const win = window()
    if (win) hideAll(win)
  })
  return host
}
