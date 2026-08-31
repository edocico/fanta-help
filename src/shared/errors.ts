/**
 * The uniform wrapper crossing the IPC boundary. Exceptions never cross it.
 *
 * The messages are the direct translation of the edge-case table of document 2,
 * as listed in document 3 §3. They live here and never in a component.
 *
 * Each code is a function, not a string, because five of them take parameters.
 * That makes `fail('EXCEEDS_MAX_BID', { team, max, n })` a compile error when a
 * parameter is missing or misspelled — the alternative, `{placeholder}` strings
 * with a substitution helper, fails silently and puts a literal `{team}` on
 * screen in front of ten people.
 */

export const errorMessages = {
  /* infrastructure — never carry parameters, always carry `details` */
  BAD_INPUT: () => 'Richiesta non valida',
  DB_UNAVAILABLE: () => 'Il database non risponde. Riavvia l’applicazione.',
  IPC_UNAVAILABLE: () => 'Il canale non risponde. Riavvia l’applicazione.',
  UNKNOWN: () => 'Qualcosa non ha funzionato',

  /* domain — document 3 §3 */
  PLAYER_ALREADY_OWNED: (p: { team: string; price: number }) =>
    `Già a ${p.team} per ${p.price}`,
  ROLE_SLOTS_FULL: (p: { team: string; n: number; role: string }) =>
    `${p.team} ha già ${p.n} ${p.role}`,
  INSUFFICIENT_CREDITS: (p: { team: string; n: number }) => `${p.team} ha ${p.n} crediti`,
  EXCEEDS_MAX_BID: (p: { team: string; max: number; n: number }) =>
    `${p.team} può arrivare a ${p.max}: deve tenere ${p.n} crediti per gli slot rimasti`,
  BELOW_MIN_BID: (p: { n: number }) => `La puntata minima è ${p.n}`,
  LEAGUE_FROZEN: () => 'Il resoconto è cristallizzato. Riaprilo per modificarlo.',
  RULES_LOCKED: () => 'Il regolamento si blocca quando parte l’asta.',
  DATASET_LOCKED: () => 'Non puoi aggiornare il listone durante un’asta.',
} as const

export type ErrorCode = keyof typeof errorMessages

/** The parameters the message for this code demands: `[]` or `[{...}]`. */
export type ErrorParams<C extends ErrorCode> = Parameters<(typeof errorMessages)[C]>

export type AppError = {
  code: ErrorCode
  message: string
  /** Diagnostics, never shown: a zod report or a thrown value. */
  details?: unknown
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function buildError<C extends ErrorCode>(code: C, ...args: ErrorParams<C>): AppError {
  // The union of message signatures cannot be called generically without this.
  const build = errorMessages[code] as (...a: ErrorParams<C>) => string
  return { code, message: build(...args) }
}

export function fail<C extends ErrorCode>(code: C, ...args: ErrorParams<C>): Result<never> {
  return { ok: false, error: buildError(code, ...args) }
}

/**
 * A domain refusal on its way out of a service.
 *
 * Services return their output and throw when they refuse, which is what lets
 * register.ts stay the shape document 3 §3 gives it. Without this class every
 * refusal would reach the renderer as UNKNOWN, and the eight domain codes above
 * would be unreachable — a bid rejected at the auction would read "Qualcosa non
 * ha funzionato" instead of naming the team and the price.
 */
export class DomainError extends Error {
  readonly appError: AppError

  constructor(error: AppError) {
    super(error.message)
    this.name = 'DomainError'
    this.appError = error
  }
}

/** Throw a domain code out of a service: `raise('BELOW_MIN_BID', { n: 1 })`. */
export function raise<C extends ErrorCode>(code: C, ...args: ErrorParams<C>): never {
  throw new DomainError(buildError(code, ...args))
}

/** Input that failed its contract schema. Carries the zod report for the log. */
export function badInput(details: unknown): Result<never> {
  return { ok: false, error: { code: 'BAD_INPUT', message: errorMessages.BAD_INPUT(), details } }
}

/** Last line of defence: turns a thrown value into a Result instead of letting it cross IPC. */
export function toResult(e: unknown): Result<never> {
  // A deliberate refusal keeps its own code and message; only genuine surprises
  // become UNKNOWN. Lose this branch and every domain error goes mute.
  if (e instanceof DomainError) return { ok: false, error: e.appError }

  return {
    ok: false,
    error: {
      code: 'UNKNOWN',
      message: errorMessages.UNKNOWN(),
      details: e instanceof Error ? e.message : String(e),
    },
  }
}
