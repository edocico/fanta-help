/**
 * The uniform wrapper crossing the IPC boundary. Exceptions never cross it.
 *
 * T4 fills in the full code table from document 2. These are only the codes
 * the packaging spike can actually produce.
 */

export type ErrorCode = 'BAD_INPUT' | 'DB_UNAVAILABLE' | 'IPC_UNAVAILABLE' | 'UNKNOWN'

/** User-facing Italian messages live next to the code, never in components. */
export const errorMessages: Record<ErrorCode, string> = {
  BAD_INPUT: 'Richiesta non valida',
  DB_UNAVAILABLE: 'Il database non risponde. Riavvia l’applicazione.',
  IPC_UNAVAILABLE: 'Il canale non risponde. Riavvia l’applicazione.',
  UNKNOWN: 'Qualcosa non ha funzionato',
}

export type AppError = {
  code: ErrorCode
  message: string
  details?: unknown
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, details?: unknown): Result<never> {
  return { ok: false, error: { code, message: errorMessages[code], details } }
}

/** Last line of defence: turns a thrown value into a Result instead of letting it cross IPC. */
export function toResult(e: unknown): Result<never> {
  const details = e instanceof Error ? e.message : String(e)
  return fail('UNKNOWN', details)
}
