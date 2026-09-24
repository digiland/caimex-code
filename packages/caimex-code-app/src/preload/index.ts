import { contextBridge, ipcRenderer, webFrame } from "electron"

contextBridge.exposeInMainWorld("caimex", {
  platform: process.platform,
  connect: () => ipcRenderer.invoke("daemon:connect"),
  exists: (path: string) => ipcRenderer.invoke("fs:exists", path),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  info: () => ipcRenderer.invoke("app:info"),
  stopDaemon: () => ipcRenderer.invoke("daemon:stop"),
  work: {
    info: () => ipcRenderer.invoke("work:info"),
    newFolder: (name: string) => ipcRenderer.invoke("work:newFolder", name),
    // A notification was clicked: show that task.
    onOpenTask: (listener: (sessionID: string) => void) => {
      const wrapped = (_event: unknown, id: string) => listener(id)
      ipcRenderer.on("work:open-task", wrapped)
      return () => void ipcRenderer.removeListener("work:open-task", wrapped)
    },
  },
  schedules: {
    list: () => ipcRenderer.invoke("schedules:list"),
    preview: (when: string) => ipcRenderer.invoke("schedules:preview", when),
    save: (input: unknown) => ipcRenderer.invoke("schedules:save", input),
    remove: (id: string) => ipcRenderer.invoke("schedules:remove", id),
    pause: (id: string, paused: boolean) => ipcRenderer.invoke("schedules:pause", id, paused),
    run: (id: string) => ipcRenderer.invoke("schedules:run", id),
    login: (value?: boolean) => ipcRenderer.invoke("schedules:login", value),
    onChange: (listener: (list: unknown) => void) => {
      const wrapped = (_event: unknown, list: unknown) => listener(list)
      ipcRenderer.on("schedules:changed", wrapped)
      return () => void ipcRenderer.removeListener("schedules:changed", wrapped)
    },
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins:list"),
    save: (entries: unknown) => ipcRenderer.invoke("plugins:save", entries),
  },
  hermes: {
    local: () => ipcRenderer.invoke("hermes:local"),
    hasKey: (id: string) => ipcRenderer.invoke("hermes:hasKey", id),
    setKey: (id: string, key: string | undefined) => ipcRenderer.invoke("hermes:setKey", id, key),
    useLocalKey: (id: string) => ipcRenderer.invoke("hermes:useLocalKey", id),
    request: (target: unknown, method: string, path: string, body?: unknown) =>
      ipcRenderer.invoke("hermes:request", target, method, path, body),
    jobOutputs: (target: unknown, jobID: string) => ipcRenderer.invoke("hermes:jobOutputs", target, jobID),
    jobOutput: (target: unknown, jobID: string, name: string) =>
      ipcRenderer.invoke("hermes:jobOutput", target, jobID, name),
    // One listener pair for every stream; the renderer routes by stream id.
    stream: (streamID: string, target: unknown, path: string) => ipcRenderer.send("hermes:stream", streamID, target, path),
    cancel: (streamID: string) => ipcRenderer.send("hermes:cancel", streamID),
    onEvent: (listener: (payload: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on("hermes:event", wrapped)
      return () => void ipcRenderer.removeListener("hermes:event", wrapped)
    },
    onEnd: (listener: (payload: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on("hermes:end", wrapped)
      return () => void ipcRenderer.removeListener("hermes:end", wrapped)
    },
  },
})
