import { ipcMain } from 'electron'
import { contracts, type Channel } from '@shared/contracts'
import { badInput, fail, ok, toResult, type Result } from '@shared/errors'
import { handlers, type HandlerContext } from './handlers'

/**
 * The only file that touches ipcMain. Validation happens here, before the
 * service is ever called, and nothing throws across the boundary: every path
 * returns a Result.
 *
 * No channel can be registered without existing in `contracts`, because the loop
 * walks the handler map and the handler map is typed against it. The reverse —
 * a contract with no handler — is what coverage.test.ts catches.
 */
export function registerAll(ctx: HandlerContext): void {
  for (const channel of Object.keys(handlers) as Channel[]) {
    ipcMain.handle(channel, async (_event, raw): Promise<Result<unknown>> => {
      const parsed = contracts[channel].input.safeParse(raw)
      if (!parsed.success) return badInput(parsed.error.flatten())

      try {
        // The map is homogeneous by construction; the union of per-channel
        // signatures cannot be called generically without this one cast.
        const handler = handlers[channel] as (i: unknown, c: HandlerContext) => unknown
        return ok(await handler(parsed.data, ctx))
      } catch (e) {
        return toResult(e)
      }
    })
  }
}

/**
 * Fallback when the database could not be opened. Every declared channel answers
 * with the same legible error instead of not existing at all — a missing channel
 * surfaces as an unhandled invoke, which says nothing about what went wrong.
 */
export function registerUnavailable(): void {
  for (const channel of Object.keys(contracts) as Channel[]) {
    ipcMain.handle(channel, () => fail('DB_UNAVAILABLE'))
  }
}
