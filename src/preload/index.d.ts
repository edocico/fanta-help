/** Shape the preload puts on `window`. The typed wrapper over it arrives in T4. */
export type Api = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
  subscribe: (topic: string, cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
