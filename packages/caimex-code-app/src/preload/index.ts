import { contextBridge, ipcRenderer, webFrame } from "electron"

contextBridge.exposeInMainWorld("caimex", {
  platform: process.platform,
  connect: () => ipcRenderer.invoke("daemon:connect"),
  exists: (path: string) => ipcRenderer.invoke("fs:exists", path),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  info: () => ipcRenderer.invoke("app:info"),
})
