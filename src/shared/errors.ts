/**
 * The uniform wrapper crossing the IPC boundary. Exceptions never cross it.
 *
 * The messages are the direct translation of the edge-case table of document 2,
 * as listed in document 3 §3. They live here and never in a component.
 *
 * Each code is a function, not a string, because some of them take parameters.
 * That makes `fail('EXCEEDS_MAX_BID', { team, max, n })` a compile error when a
 * parameter is missing or misspelled — the alternative, `{placeholder}` strings
 * with a substitution helper, fails silently and puts a literal `{team}` on
 * screen in front of ten people.
 */

import { ROLE_LABELS, type CoherenceWarning } from './domain'

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

  /* la lega e le squadre — T11, invarianti 8, 9 e 13 */
  // Invariante 9. Il documento 3 §3 non la elenca perché la sua tabella traduce
  // i casi limite del documento 2 §7, che parlano dell'asta: prima dell'asta il
  // documento non prevedeva che si potesse sbagliare. Si può, e la cascata di
  // fanta_team porterebbe via gli acquisti in silenzio.
  TEAMS_LOCKED: () => 'Le squadre si aggiungono, si tolgono e si riordinano prima dell’asta.',
  // Il vincolo UNIQUE (league_id, name) esiste nello schema: senza questo codice
  // arriverebbe al renderer come UNKNOWN da dentro la transazione.
  TEAM_NAME_TAKEN: (p: { name: string }) => `C’è già una squadra che si chiama ${p.name}`,
  TOO_FEW_TEAMS: () => 'Servono almeno due squadre.',
  // L'invariante 9 letta un piano sopra: quello che protegge non è lo stato, sono
  // gli acquisti che la cascata porterebbe via.
  LEAGUE_HAS_PURCHASES: (p: { n: number }) =>
    p.n === 1
      ? 'Questa lega ha un acquisto registrato: toglilo dalla revisione prima di cancellarla.'
      : `Questa lega ha ${p.n} acquisti: toglili dalla revisione prima di cancellarla.`,
  // Come sopra, per l'indice parziale idx_one_mine.
  TOO_MANY_MINE: () => 'Una sola squadra può essere la tua.',
  LEAGUE_SEASON_MISSING: (p: { seasonId: string }) =>
    `La stagione ${p.seasonId} non è installata. Importa il listone prima di creare la lega.`,
  // Una rotta rimasta aperta su qualcosa che nel frattempo è stato cancellato.
  LEAGUE_MISSING: () => 'Questa lega non esiste più.',
  TEAM_MISSING: () => 'Questa squadra non esiste più.',

  /* obiettivi e piani — T12 */
  // L'invariante 7 fuori dagli acquisti: né un obiettivo né una casella di un
  // piano possono puntare a un giocatore di un'altra stagione. Nello schema
  // niente lo impedisce — `target.player_id` e `plan_item.player_id` guardano
  // `player`, non la stagione della lega — quindi lo impone il servizio.
  PLAYER_WRONG_SEASON: (p: { season: string }) =>
    `Questo giocatore non è nel listone ${p.season} della lega`,
  // Chiave primaria (plan_id, player_id): senza questo codice il secondo
  // inserimento arriverebbe come UNKNOWN.
  PLAN_ITEM_EXISTS: (p: { name: string }) => `${p.name} è già in questo piano`,
  // Le caselle della griglia sono `league_slot.slots`, e il piano non ne inventa
  // una in più. Un piano può *trovarsi* con giocatori oltre gli slot — succede
  // abbassando gli slot dopo averlo costruito, che l'invariante 16 permette in
  // `pre_auction` — ma non può crearli.
  PLAN_ROLE_FULL: (p: { n: number; one: string; many: string }) =>
    // Tre rami perché il ruolo a zero slot esiste davvero: la lega può decidere
    // di non averne, e «il piano ha già 0 portieri» non è una frase.
    p.n === 0
      ? `La lega non ha slot per i ${p.many}.`
      : p.n === 1
        ? `Il piano ha già un ${p.one}: libera la casella o alza gli slot.`
        : `Il piano ha già ${p.n} ${p.many}: liberane una casella o alza gli slot.`,
  PLAN_MISSING: () => 'Questo piano non esiste più.',
  PLAN_ITEM_MISSING: () => 'Questa casella non è più nel piano.',

  /* import of a dataset — document 4 §6 */
  DATASET_MANIFEST_UNREADABLE: () =>
    'Il manifest del dataset non si legge. Controlla la cartella indicata.',
  DATASET_SEASON_MISSING: (p: { seasonId: string }) =>
    `Il manifest non contiene la stagione ${p.seasonId}`,
  // Distinct from the one above on purpose: a manifest whose `latest` names a
  // version its own `versions` list does not have is a broken manifest, and
  // saying the season is missing sends whoever reads it to look at the wrong end.
  DATASET_VERSION_MISSING: (p: { seasonId: string; version: string }) =>
    `Il manifest indica ${p.version} per ${p.seasonId} ma non la elenca`,
  DATASET_FILE_MISSING: (p: { file: string }) =>
    `Manca il file ${p.file} che il manifest indica`,
  // Step 3 of document 4 §6: "verifica lo sha256. Se non corrisponde, si ferma."
  DATASET_CHECKSUM_MISMATCH: (p: { file: string }) =>
    `${p.file} non corrisponde al manifest. Riscaricalo o rigeneralo.`,
  DATASET_INVALID: () => 'Il dataset non ha il formato atteso. Rigeneralo con la pipeline.',

  /* import of a listone .xlsx — document 4 §6, "Dal file XLSX" */
  XLSX_UNREADABLE: () => 'Il file non si apre. Deve essere un .xlsx scaricato da Fantacalcio.it.',
  XLSX_NO_HEADER: (p: { columns: string }) =>
    `Nessuna riga del foglio contiene le colonne ${p.columns}. Non sembra un listone.`,
  XLSX_DUPLICATE_COLUMN: (p: { column: string }) =>
    `La riga di intestazione ripete la colonna ${p.column}: non si può leggere per nome.`,
  // Names the likeliest cause and not just the fact: the file that trips this is
  // almost always Statistiche_*.xlsx, which sits in the same download folder as
  // the one that works, one letter apart in the file picker.
  XLSX_MISSING_COLUMNS: (p: { columns: string }) =>
    `Colonne mancanti: ${p.columns}. Se hai scaricato le statistiche, serve invece il file delle quotazioni.`,
  XLSX_NO_ROWS: () =>
    'Il file ha le colonne giuste e nessun giocatore. Controlla di aver scaricato il listone completo.',
  XLSX_SEASON_INVALID: (p: { seasonId: string }) =>
    `"${p.seasonId}" non è una stagione. Il formato è 2026-27.`,
  // Document 4 §6: "un import parziale silenzioso è peggio di un import fallito".
  XLSX_TOO_MANY_BAD_ROWS: (p: { n: number; total: number }) =>
    `${p.n} righe su ${p.total} non si leggono. Il file è di un formato diverso: controlla di aver scaricato le quotazioni.`,
  XLSX_DUPLICATE_IDS: (p: { ids: string }) =>
    `Il file ripete gli Id ${p.ids}: non è un listone intero, riscaricalo.`,
} as const

export type ErrorCode = keyof typeof errorMessages

/** The parameters the message for this code demands: `[]` or `[{...}]`. */
export type ErrorParams<C extends ErrorCode> = Parameters<(typeof errorMessages)[C]>

/**
 * The sentences for the coherence warnings of document 2 §4.3, step 3.
 *
 * Not errors: they are computed by a pure function, they travel inside a
 * successful answer and they never stop anything — "se qualcosa non torna lo dice
 * subito, senza bloccare". They live here anyway, beside the refusals, for the
 * reason CLAUDE.md gives for those: text that the interface writes is text that
 * two screens end up wording differently.
 *
 * A `switch` over the union rather than a map keyed by code, so a warning added
 * to `CoherenceWarning` without a sentence is a compile error here instead of an
 * `undefined` on screen.
 */
export function warningMessage(warning: CoherenceWarning): string {
  switch (warning.code) {
    case 'NOT_ENOUGH_PLAYERS':
      return `Servono ${warning.needed} ${ROLE_LABELS[warning.role]} e il listone ne ha ${warning.available}`
    case 'BUDGET_BELOW_SLOTS':
      return `Il budget di ${warning.budget} non basta: servono ${warning.needed} crediti per riempire la rosa alla puntata minima`
  }
}

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
 * The AppError for a code, without failing anything.
 *
 * For the one case that is neither a success nor a refusal: the XLSX preview of
 * document 2 §4.1 has to *show* why a file cannot be imported while the call
 * itself succeeds. Carrying the same AppError the import would later raise keeps
 * the two from ever wording it differently.
 */
export function appError<C extends ErrorCode>(code: C, ...args: ErrorParams<C>): AppError {
  return buildError(code, ...args)
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
