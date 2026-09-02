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

import {
  ROLE_LABELS,
  ROLE_LABELS_ONE,
  type ClassicRole,
  type CoherenceWarning,
  type RosterAnomaly,
  type Violation,
} from './domain'

/**
 * «un credito» / «N crediti», in un posto solo.
 *
 * Il CLAUDE.md lo dice in una riga che è già costata tre task: «Un messaggio che
 * conta sa contare fino a uno e a zero». La puntata minima legale è 1
 * (`contracts.ts`), quindi nella seconda metà di ogni asta gran parte degli
 * acquisti si chiude proprio lì, e il toast — la frase più letta della serata —
 * direbbe «Svilar → Real Fanta, 1 crediti» decine di volte.
 *
 * Una funzione e non un ramo in linea perché i punti che contano crediti sono
 * sei, sparsi fra due processi: due messaggi di rifiuto qui sotto, il toast, due
 * righe di cronologia. Scritti a mano, il primo che si dimentica il ramo è
 * indistinguibile dagli altri finché non lo si legge a schermo.
 */
export function credits(n: number): string {
  return n === 1 ? '1 credito' : `${n} crediti`
}

/**
 * «una squadra ha slot liberi» / «N squadre hanno slot liberi».
 *
 * Un frammento e non due frasi intere, perché i due lettori la incastonano
 * diversamente: la conferma di chiusura chiede «… Chiudere lo stesso?», la
 * cronologia scrive «asta chiusa, …». In T14 le due frasi erano state scritte
 * separatamente e avevano già preso strade diverse.
 */
export function teamsWithFreeSlots(n: number): string {
  return n === 1 ? 'una squadra ha slot liberi' : `${n} squadre hanno slot liberi`
}

/**
 * I due conteggi dell'intestazione della revisione, documento 2 §4.10:
 * «198 acquisti · 4 anomalie».
 *
 * Qui accanto a `credits` e non nel componente perché contano, ed è la famiglia
 * di frasi che il CLAUDE.md dice essere già uscita sbagliata tre volte. Con una
 * lega di prova a due squadre e un acquisto solo — cioè la sera che si prova
 * l'app — l'intestazione direbbe «1 acquisti».
 *
 * Lo zero c'è in tutte e due. L'intestazione si stampa **prima** del ramo che
 * decide di mostrare la tabella vuota, e `auction.close` non pretende nessun
 * acquisto per passare in revisione: una lega chiusa a vuoto leggeva «0
 * acquisti» accanto a un vicino di riga che lo zero lo sa dire a parole.
 */
export function purchases(n: number): string {
  return n === 0 ? 'nessun acquisto' : n === 1 ? '1 acquisto' : `${n} acquisti`
}

export function anomalies(n: number): string {
  return n === 0 ? 'nessuna anomalia' : n === 1 ? '1 anomalia' : `${n} anomalie`
}

export const errorMessages = {
  /* infrastructure — never carry parameters, always carry `details` */
  BAD_INPUT: () => 'Richiesta non valida',
  DB_UNAVAILABLE: () => 'Il database non risponde. Riavvia l’applicazione.',
  IPC_UNAVAILABLE: () => 'Il canale non risponde. Riavvia l’applicazione.',
  UNKNOWN: () => 'Qualcosa non ha funzionato',

  /* domain — document 3 §3 */
  PLAYER_ALREADY_OWNED: (p: { team: string; price: number }) =>
    `Già a ${p.team} per ${p.price}`,
  // Tre rami come PLAN_ROLE_FULL, e per lo stesso motivo: un ruolo con zero slot
  // esiste (il regolamento resta modificabile fino all'apertura), e «ha già 0
  // portieri» non è una frase. Il ramo plurale è quello del documento 2 §7,
  // parola per parola: «Real Fanta ha già 8 difensori».
  ROLE_SLOTS_FULL: (p: { team: string; n: number; one: string; many: string }) =>
    p.n === 0
      ? `La lega non ha slot per i ${p.many}.`
      : p.n === 1
        ? `${p.team} ha già un ${p.one}`
        : `${p.team} ha già ${p.n} ${p.many}`,
  // Le due frasi del documento 2 §7 con il ramo a uno che il documento non
  // scrive perché i suoi esempi hanno numeri grandi. T14 ne cambia il peso: da
  // rifiuti che tornavano dopo l'Invio sono diventate testo stampato sotto il
  // campo prezzo a ogni cifra digitata, e nel finale d'asta `keep` vale 1 su
  // quasi tutte le squadre.
  INSUFFICIENT_CREDITS: (p: { team: string; n: number }) => `${p.team} ha ${credits(p.n)}`,
  EXCEEDS_MAX_BID: (p: { team: string; max: number; n: number }) =>
    `${p.team} può arrivare a ${p.max}: deve tenere ${credits(p.n)} per gli slot rimasti`,
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

  /* l'asta — T13, invarianti 8 e 13 */
  // Assegnare, annullare e passare il turno hanno tutti lo stesso presupposto.
  // Ci si arriva solo con un'interfaccia rimasta indietro rispetto al database.
  AUCTION_NOT_OPEN: () => 'L’asta non è aperta.',
  AUCTION_ALREADY_OPEN: () => 'L’asta è già stata aperta.',
  // L'altra metà dell'invariante 8. Il wizard non può produrre una rosa di soli
  // zeri, ma il regolamento resta modificabile fino a questo momento.
  LEAGUE_SLOTS_EMPTY: () =>
    'La rosa non ha nessuno slot: configurala prima di aprire l’asta.',
  NOTHING_TO_UNDO: () => 'Non c’è niente da annullare.',

  /* la revisione — T16, invarianti 11 e 12 */
  // Come LEAGUE_MISSING e TEAM_MISSING: una tabella rimasta aperta su una riga
  // che nel frattempo qualcuno ha eliminato. In revisione capita davvero, perché
  // la stessa schermata elimina righe.
  PURCHASE_MISSING: () => 'Questo acquisto non esiste più.',

  /* la cristallizzazione — T17, invarianti 13 e 14 */
  // Ci si arriva da un'interfaccia rimasta indietro: il bottone vive solo nella
  // revisione. La frase dice dov'è, non che la richiesta era invalida.
  NOT_IN_REVIEW: () => 'Il resoconto si cristallizza dalla revisione.',
  NOT_CRYSTALLISED: () => 'Questa lega non è cristallizzata: non c’è niente da riaprire.',

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

/**
 * The sentence for one violation of `checkPurchase`, with the numbers in place.
 *
 * Here and not in the auction service, because it has two readers now. The
 * service raises it as a refusal; the assignment panel of document 2 §4.8 shows
 * it *before* the Enter, to grey out the button "per cortesia" as rule 2 of
 * CLAUDE.md puts it. Written twice, the two would word the same rule differently
 * — and this is the exact family of sentences the revision has already caught
 * three times for not knowing how to count to one.
 *
 * `role` and `team` are arguments rather than fields of the violation: the pure
 * function that produces it works on a `RosterState`, which knows neither whose
 * roster it is nor which role was asked for. The caller has both.
 *
 * A `switch` over the discriminated union, for the reason `warningMessage` gives
 * above it: a code added to `Violation` without a branch is a compile error here
 * instead of an `undefined` on screen.
 */
export function violationMessage(v: Violation, team: string, role: ClassicRole): string {
  switch (v.code) {
    case 'BELOW_MIN_BID':
      return errorMessages.BELOW_MIN_BID({ n: v.detail.n })
    case 'ROLE_SLOTS_FULL':
      return errorMessages.ROLE_SLOTS_FULL({
        team,
        n: v.detail.n,
        one: ROLE_LABELS_ONE[role],
        many: ROLE_LABELS[role],
      })
    case 'INSUFFICIENT_CREDITS':
      return errorMessages.INSUFFICIENT_CREDITS({ team, n: v.detail.n })
    case 'EXCEEDS_MAX_BID':
      return errorMessages.EXCEEDS_MAX_BID({ team, max: v.detail.max, n: v.detail.keep })
  }
}

/**
 * La frase di una singola anomalia del pannello controlli, documento 2 §4.10.
 *
 * Accanto a `violationMessage` e per la stessa ragione, che qui vale doppio: il
 * pannello raggruppa per squadra e **mostra tutte** le anomalie, quindi in una
 * revisione vera queste righe sono decine sullo stesso schermo. Una che non sa
 * contare fino a uno — «1 portieri mancante» — non passa inosservata come
 * passerebbe in un rifiuto che compare per un secondo.
 *
 * Il ruolo viaggia dentro l'anomalia, al contrario che in una violazione: una
 * violazione riguarda l'acquisto che sta arrivando e il ruolo lo sa chi chiama,
 * una rosa ne nomina quattro in fila e nessun chiamante saprebbe quale.
 *
 * Nessuna di queste frasi comincia per maiuscola: il pannello le scrive sotto il
 * nome della squadra, che è già il soggetto. «Real Fanta → 9 difensori su 8».
 */
export function anomalyMessage(a: RosterAnomaly): string {
  switch (a.code) {
    case 'OVER_BUDGET':
      return `sforato di ${credits(a.detail.n)}`
    /**
     * Invariante 4 vista da ferma. Dice i due numeri invece del verdetto perché
     * il verdetto da solo — «non può completare la rosa» — non fa capire di
     * quanto, e in revisione la domanda successiva è sempre quella.
     */
    case 'NOT_COMPLETABLE':
      return `${credits(a.detail.credits)} per ${a.detail.slots} slot da riempire`
    case 'ROLE_OVER':
      return a.detail.have === 1
        ? `1 ${ROLE_LABELS_ONE[a.role]} su ${a.detail.slots}`
        : `${a.detail.have} ${ROLE_LABELS[a.role]} su ${a.detail.slots}`
    case 'ROLE_MISSING':
      return a.detail.n === 1
        ? `1 ${ROLE_LABELS_ONE[a.role]} mancante`
        : `${a.detail.n} ${ROLE_LABELS[a.role]} mancanti`
  }
}

/**
 * Le frasi della tabella del documento 2 §7 che **nessun servizio lancia**.
 *
 * Il CLAUDE.md è netto — «I messaggi d'errore stanno in `src/shared/errors.ts`
 * accanto al codice, mai sparsi nei componenti» — e queste sono righe di quella
 * tabella come le altre: constatano un rifiuto dell'interfaccia, non un rifiuto
 * del main. Una rosa completa arriva al processo principale come
 * `ROLE_SLOTS_FULL`, e aggiungere un codice che niente solleva metterebbe un
 * ramo irraggiungibile nel file che promette che ogni codice è un rifiuto vero.
 * Quindi vivono qui accanto, non dentro `errorMessages`.
 *
 * Il precedente è `warningMessage` più sotto, che sta in questo file per la
 * stessa ragione: non è un rifiuto e non attraversa l'IPC. Il costo di non
 * averle qui si è già visto in T14, dove «una squadra ha slot liberi» era stata
 * scritta due volte da due autori con due esiti diversi.
 */
export const notices = {
  /** Documento 2 §7, parola per parola. */
  NO_SEARCH_RESULTS: () => 'Nessun giocatore. Prova con meno lettere.',
  /** L'altra metà di «rosa completa → la squadra sparisce dal selettore». */
  ROSTER_COMPLETE: (p: { team: string }) => `${p.team} ha completato la rosa`,
  /**
   * Invariante 10: è uscito dal listone, i suoi acquisti no.
   *
   * §7 scrive «Non è più nel listone del 5 settembre», cioè la **data** della
   * versione installata — che `AuctionState` non porta e che il pannello non ha
   * modo di sapere. Nominare la stagione al posto della data direbbe una cosa
   * falsa: «non è più nel listone 2026-27» sotto un giocatore che stai
   * comprando proprio da lì. Questa è la frase che PlayerDetail usa già.
   */
  DELISTED: () => 'Non è più nel listone importato.',
  /** §7: «permesso, con avviso». La domanda, non un rifiuto. */
  CLOSE_WITH_FREE_SLOTS: (p: { n: number }) =>
    `${capitalize(teamsWithFreeSlots(p.n))}. Chiudere lo stesso?`,
  /**
   * La conferma della cristallizzazione, §4.10: «se ci sono anomalie il bottone
   * chiede conferma elencandole, ma non le impone».
   *
   * Qui accanto e non in linea nel componente, che è il precedente di
   * `CLOSE_WITH_FREE_SLOTS` due righe più giù: scritta nel componente, la
   * concordanza a uno era stata dimenticata — «1 anomalia **aperte**» — perché
   * il ramo singolare c'era per il sostantivo e non per l'aggettivo.
   *
   * Nessun ramo per lo zero: chi la chiama mostra la conferma solo quando c'è
   * qualcosa da elencare, e un ramo che nessun dato può raggiungere è una riga
   * che finge di esserci.
   */
  ANOMALIES_OPEN: (p: { n: number }) =>
    p.n === 1 ? '1 anomalia aperta:' : `${p.n} anomalie aperte:`,
  /** Il campo squadra prima che ci sia scritto qualcosa. */
  PICK_A_TEAM: () => 'Scegli la squadra: le prime lettere, o il suo numero.',
  /**
   * Lo stato di una lega cristallizzata, *descritto*.
   *
   * Non `LEAGUE_FROZEN`, che è il rifiuto di una scrittura tentata e finisce con
   * «Riaprilo per modificarlo»: un invito giusto in cima a un tentativo, e a
   * vuoto su una schermata che sta solo dicendo dove sei — il comando di
   * riapertura vive nel resoconto, sotto un bottone suo. Due lettori, la scheda
   * della lega e la revisione, e quindi una frase sola.
   */
  CRYSTALLISED: () => 'Il resoconto è cristallizzato. Riaprirlo riporta in revisione.',
} as const

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
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
