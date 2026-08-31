import type { Channel, EventPayload, EventTopic, Input, Output } from '@shared/contracts'
import type { AppError, Result } from '@shared/errors'

/** Carries the AppError so a caller can read the code, not just the message. */
export class IpcError extends Error {
  readonly error: AppError

  constructor(error: AppError) {
    super(error.message)
    this.name = 'IpcError'
    this.error = error
  }
}

/**
 * The typed wrapper over `window.api.invoke`. The renderer never names a raw
 * channel string anywhere else, and never sees a Result: a failure arrives as a
 * thrown IpcError, which is what TanStack Query expects from a query function.
 */
export async function call<C extends Channel>(
  channel: C,
  // Variadic so a channel whose input is z.void() is called as `call('app.instance')`
  // instead of `call('app.instance', undefined)`. Same shape as fail() in errors.ts.
  ...args: Input<C> extends void ? [] : [input: Input<C>]
): Promise<Output<C>> {
  const res = (await window.api.invoke(channel, args[0])) as Result<Output<C>>
  if (!res.ok) throw new IpcError(res.error)
  return res.data
}

/** Returns the unsubscribe function, so a useEffect can use it as its cleanup. */
export function subscribe<T extends EventTopic>(
  topic: T,
  cb: (payload: EventPayload<T>) => void,
): () => void {
  return window.api.subscribe(topic, (payload) => cb(payload as EventPayload<T>))
}
