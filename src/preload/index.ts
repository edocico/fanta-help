import { contextBridge, ipcRenderer } from 'electron'

// Two functions, and no knowledge of any channel. Runs sandboxed, so it may
// only use the reduced module set Electron exposes to a sandboxed preload.
contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),

  subscribe: (topic: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(`event:${topic}`, listener)
    return () => {
      ipcRenderer.off(`event:${topic}`, listener)
    }
  },
})
