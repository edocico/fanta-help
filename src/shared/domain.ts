/**
 * Pure domain functions: roles, calculations, constants. No Node, no DOM, no
 * database — compiled by both tsconfigs, usable from the main process, the
 * renderer and the offline pipeline in tools/.
 *
 * The auction invariants land here in T13, as document 6 §3 prescribes.
 */

/**
 * The four classic roles.
 *
 * Here and not beside each schema that constrains them: the IPC contracts and the
 * dataset format check the same four letters, and two copies drift the day a
 * fifth appears. `src/main/db/schema.ts` keeps its own list on purpose — it
 * declares itself a transcription of the DDL in document 1, and answers to that.
 */
export const CLASSIC_ROLES = ['P', 'D', 'C', 'A'] as const
export type ClassicRole = (typeof CLASSIC_ROLES)[number]

/**
 * The four roles as words, plural, because every sentence that names one names
 * several: "Real Fanta ha già 8 difensori", "servono 96 attaccanti".
 *
 * The only Italian in this file, and here rather than in a component because it
 * already has two callers that must not disagree — the `ROLE_SLOTS_FULL` message
 * of shared/errors.ts, which is handed the word rather than the letter, and the
 * coherence warnings of the wizard. The tables of document 2 §4.4 keep the bare
 * letter on purpose: a column heading is not a sentence.
 */
export const ROLE_LABELS: Readonly<Record<ClassicRole, string>> = {
  P: 'portieri',
  D: 'difensori',
  C: 'centrocampisti',
  A: 'attaccanti',
}

/**
 * The same four in the singular, for the sentences that can name exactly one.
 *
 * Not a nicety: a league with a single slot for a role produces "ha già 1
 * attaccanti", and a message that cannot count to one reads like a machine wrote
 * it — on the screen where someone is being told why the app said no.
 */
export const ROLE_LABELS_ONE: Readonly<Record<ClassicRole, string>> = {
  P: 'portiere',
  D: 'difensore',
  C: 'centrocampista',
  A: 'attaccante',
}

/**
 * The twelve Mantra roles, in the order Fantacalcio.it lists them: goalkeeper
 * first, then outwards from defence.
 *
 * The listone packs them into a single cell separated by ';', up to three per
 * player — 'Dd;Dc', 'E;W'. `B` (braccetto) is easy to miss: it appears in the
 * files and in no summary of the role set.
 */
export const MANTRA_ROLES = ['Por', 'Dd', 'Ds', 'Dc', 'B', 'E', 'M', 'C', 'W', 'T', 'A', 'Pc'] as const
export type MantraRole = (typeof MANTRA_ROLES)[number]

/**
 * The four steps of document 4: lowercase, NFD with diacritics removed,
 * apostrophes and punctuation removed, multiple spaces collapsed.
 *
 *   Vlahović → vlahovic · N'Dicka → ndicka · Sánchez → sanchez
 *
 * It lives here, and not next to whoever calls it, because two implementations
 * of this would diverge in silence: the pipeline writes `player.name_normalized`
 * with it and the app searches that column with it. If the two ever disagree,
 * searching for a name that exists returns nothing and no test fails.
 *
 * The four cases above are under test in domain.test.ts, per document 6 §7.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The full name, but only when it says something the listone's name does not.
 *
 * The listone writes a surname and, where two players share it, a disambiguating
 * abbreviation: `Martinez L.`, `Pellegrini Lu.`, `Esposito F.P.`. FBref writes
 * given name and surname, for everybody. So the two agree **rarely**, not often:
 * 407 of the 524 names in the 2026-27 listone are a single word, and FBref puts
 * a given name in front of every one of them — `Zortea` against `Nadir Zortea`.
 * What is left is the mononym, the player known by one name and listed under it
 * by both sources, and there are a handful.
 *
 * That the rare case is the rare one still has to be said, because it is the one
 * that reads as a bug: `Bremer · Bremer` on a row, and a spelling repeated in
 * the search index.
 *
 * Compared through `normalizeName` and not by string equality, because the two
 * sources disagree about accents constantly: `Vlahovic` against `Vlahović` is
 * the same name written twice, and showing both would be noise dressed as
 * information.
 */
export function spelledOut(name: string, fullName: string | null): string | null {
  if (fullName === null) return null
  const spelled = normalizeName(fullName)
  if (spelled === '' || spelled === normalizeName(name)) return null
  return fullName
}


/**
 * Which backup files to delete so that at most `keep` survive, newest kept.
 *
 * Pure, and here rather than beside the code that unlinks files, for one reason:
 * it is the only part of the rotation of document 4 §6 that can be off by one,
 * and it cannot fire until an eleventh import — long after anyone is watching it.
 * The names carry a sortable timestamp (see db/backup.ts, which builds them), so
 * lexicographic order is chronological order and no date is ever parsed back.
 *
 * A negative `keep` is clamped to zero rather than refused: this decides how many
 * files to *delete*, and there is no reading of a bad argument that should end in
 * deleting more than everything.
 */
export function backupsToPrune(names: readonly string[], keep: number): string[] {
  const sorted = [...names].sort()
  return sorted.slice(0, Math.max(0, sorted.length - Math.max(0, keep)))
}

/**
 * Serie A plays 38 matchdays. Document 1 §6 asks for it by name rather than as a
 * number scattered through the code, because it is the denominator of
 * `reliability` and a league that changed size would otherwise need finding in
 * every file that divides by it.
 */
export const MATCHDAYS = 38

/**
 * The derived metrics of document 1 §6.
 *
 * Every one of them returns `null` rather than a number when it cannot be
 * computed, and that is the whole design. The alternatives are worse in a way
 * this project has already been bitten by: `0 / 0` is `NaN`, which formats as
 * "NaN" on screen and sorts unpredictably, while substituting zero says
 * something false — a goalkeeper with no rated match would show a malus rate of
 * zero and sort above one who actually played cleanly. The pipeline already
 * makes the same distinction for `Mv` with `Pv 0`: zero is not an average, it is
 * how a file spells "no data".
 *
 * Callers render `null` as an em dash. They must not coalesce it to zero.
 */

/** `null` unless both parts are known and the denominator can divide. */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null
  if (denominator === 0) return null
  return numerator / denominator
}

/** `FM − MV`: how much a player brings beyond the vote itself. */
export function bonusIndex(fantaAvg: number | null, avgVote: number | null): number | null {
  if (fantaAvg === null || avgVote === null) return null
  return fantaAvg - avgVote
}

/**
 * `Pv / 38`: in how many matchdays he actually turned up with a vote.
 *
 * Document 1 §6 names its own limitation, and T10 has to show it: this punishes
 * whoever arrived in January exactly as if he had been benched all autumn. The
 * number is honest, the reading of it is not automatic.
 */
export function reliability(matchesRated: number | null): number | null {
  return ratio(matchesRated, MATCHDAYS)
}

/** `(gialli + rossi×2 + autogol) / Pv`: how often he costs you rather than pays. */
export function malusRate(
  yellowCards: number | null,
  redCards: number | null,
  ownGoals: number | null,
  matchesRated: number | null,
): number | null {
  if (yellowCards === null || redCards === null || ownGoals === null) return null
  return ratio(yellowCards + redCards * 2 + ownGoals, matchesRated)
}

/** `Gs / Pv`: goalkeepers, and worth more with the defence modifier on. */
export function concededPerMatch(
  goalsConceded: number | null,
  matchesRated: number | null,
): number | null {
  return ratio(goalsConceded, matchesRated)
}

/** `Starts / MP`: a starter or someone who comes on. Needs the FBref stage. */
export function startShare(starts: number | null, matchesPlayed: number | null): number | null {
  return ratio(starts, matchesPlayed)
}

/** `Min / MP`: how long he stays on when he plays. Needs the FBref stage. */
export function minutesPerMatch(
  minutes: number | null,
  matchesPlayed: number | null,
): number | null {
  return ratio(minutes, matchesPlayed)
}

/** `CS / Starts`: goalkeepers. Needs the FBref stage. */
export function cleanSheetRate(cleanSheets: number | null, starts: number | null): number | null {
  return ratio(cleanSheets, starts)
}

/**
 * `score / quotazione`, with the guard on zero document 1 §6 asks for by name.
 *
 * A quotazione of zero is not hypothetical: the listone carries it for players
 * who left mid-season, and dividing by it would put them at the top of a column
 * meant to say "good value".
 */
export function convenience(score: number | null, quotazione: number | null): number | null {
  return ratio(score, quotazione)
}

/**
 * The window the empty history names, read from the seasons that are there.
 *
 * Document 2 §8 makes the absent history the one deliberate exception to "uno
 * stato vuoto è un invito ad agire": there is nothing to invite, because he did
 * not play. What the line owes the reader instead is the window it looked in —
 * and the document asks for it to come from the seasons present in
 * `player_season_stat` rather than written by hand, because a dataset that
 * gains or loses a season would otherwise leave the sentence lying.
 *
 * Season ids sort lexicographically because they are `YYYY-YY`: '2023-24' <
 * '2024-25' as strings and as years both.
 */
export function seasonWindow(seasons: readonly string[]): string | null {
  if (seasons.length === 0) return null
  const sorted = [...seasons].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  return first === last ? first : `${first} → ${last}`
}

/** One season's numbers, structurally: enough for the two rules below. */
type StatRow = Readonly<Record<string, number | null>>

/**
 * Whether there is a history at all — the boundary document 2 §9 draws between
 * absence and scarcity: "Lo storico si nasconde solo quando non c'è, mai perché
 * è poco."
 *
 * History means **past** seasons. The season the listone belongs to does not
 * count, and that is not a reading of the prose but of the two numbers the
 * documents give. §9 says the empty case is "108 giocatori su 524", and 108 is
 * exactly the count of players with no row outside the listone's own season —
 * every one of the 524 has a row for the current one, carrying zeroes rather
 * than nulls. §8 names the window `(2023-24 → 2025-26)` and leaves the current
 * season out of it. A guard that looked at every season would be true for all
 * 524 and the empty state would never appear.
 *
 * That does not hide this season's form: document 4 §4 says "a un'asta di
 * inizio settembre la forma attuale pesa quanto lo storico", so the current
 * season is shown — it just is not what makes a player have a past.
 *
 * `currentSeason` null means "no listone season to exclude": then any row is a
 * history, which is what a caller with nothing else to go on should assume.
 */
export function hasHistory(
  stats: Readonly<Record<string, StatRow>>,
  currentSeason: string | null,
): boolean {
  return Object.keys(stats).some((season) => season !== currentSeason)
}

/**
 * The shared scale of the FM/MV chart, document 2 §4.5.
 *
 * One scale for both series, not one each. Independent axes would draw an MV of
 * 5,9 and an FM of 9,1 at the same height, which is precisely the distance the
 * reader opened the panel to see.
 *
 * Missing seasons are skipped rather than read as zero: a false zero drags the
 * floor down and flattens both lines into the top of the box. And a player whose
 * numbers never moved still gets an interval, because a zero-height range would
 * divide by zero on every point.
 */
export function chartBounds(
  series: readonly (readonly (number | null)[])[],
): { min: number; max: number } | null {
  const values = series.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  if (values.length === 0) return null
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low === high) return { min: low - 0.5, max: high + 0.5 }
  const pad = (high - low) * 0.08
  return { min: low - pad, max: high + pad }
}

/* ------------------------------------------------------------------ league */

/**
 * The life cycle of document 1 §3, as data rather than as a chain of `if`s
 * scattered through the services.
 *
 * Every arrow of that diagram is here and nothing else is: a state can only be
 * reached from the state the document draws an arrow from. `closed → review` is
 * the reopening, and it is the only arrow that goes backwards — an auction does
 * not return to `pre_auction`, because the purchases already exist.
 */
export const LEAGUE_STATUSES = ['setup', 'pre_auction', 'auction', 'review', 'closed'] as const
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number]

export const LEAGUE_TRANSITIONS: Readonly<Record<LeagueStatus, readonly LeagueStatus[]>> = {
  setup: ['pre_auction'],
  pre_auction: ['auction'],
  auction: ['review'],
  review: ['closed'],
  closed: ['review'],
}

export function canTransition(from: LeagueStatus, to: LeagueStatus): boolean {
  return LEAGUE_TRANSITIONS[from].includes(to)
}

/**
 * Invariant 16: the rules are settled before the auction and read-only after it
 * starts, revision included. `budget`, `min_bid`, `auction_format`, `mode`,
 * `defense_modifier` and `league_slot`.
 *
 * Document 2 §9 gives the reason it is a rule and not a preference: taking the
 * possibility away "elimina una categoria intera di stati incoerenti" — a budget
 * lowered halfway through would make purchases already registered illegal.
 */
export function rulesEditable(status: LeagueStatus): boolean {
  return status === 'setup' || status === 'pre_auction'
}

/**
 * Invariant 9: a team can be removed only in `setup` and `pre_auction`, because
 * afterwards `ON DELETE CASCADE` would take its purchases with it in silence.
 *
 * Adding and reordering answer to the same predicate rather than to a laxer one.
 * The cascade is the documented reason for removal; for the other two it is the
 * arithmetic — `order_index` is the turn of a draft in progress, and a team that
 * appears after the auction starts owns a full budget nobody bid against.
 *
 * Deliberately a second function with the same body as `rulesEditable`. They
 * answer to two different invariants, and the day one of them moves — a rule
 * that stays editable in review, say — a shared predicate would move both.
 */
export function teamListEditable(status: LeagueStatus): boolean {
  return status === 'setup' || status === 'pre_auction'
}

/**
 * Invariant 13: in `closed` nothing is written to `purchase`, `fanta_team` or
 * `league_slot`. Renaming a team or changing its colour is harmless in every
 * other state — it carries no arithmetic — so this is the only thing standing
 * between the cosmetics of a team and the frozen report.
 */
export function frozen(status: LeagueStatus): boolean {
  return status === 'closed'
}

/** Document 2 §4.3, step 3: "precompilati a 3/8/8/6". */
export const DEFAULT_SLOTS: Readonly<Record<ClassicRole, number>> = { P: 3, D: 8, C: 8, A: 6 }

export function totalSlots(slots: Readonly<Record<ClassicRole, number>>): number {
  return CLASSIC_ROLES.reduce((sum, role) => sum + slots[role], 0)
}

/**
 * The ten hues of document 2 §4.3, "una palette predefinita di dieci tinte
 * distinguibili".
 *
 * The document does not list them, and the three constraints that decide them
 * are all in §2. They have to read on `--pitch-900`, they have to stay apart
 * from each other, and they have to stay away from the three colours that
 * already mean something: amber `#E8B33D` is money and "nient'altro usa quel
 * colore", `#A8483E` is a player already taken, `#4FB8A8` is a target. So the
 * wheel is walked leaving the amber-yellow arc and the teal around 172° empty,
 * and every hue is brighter and more saturated than the semantic three — a team
 * colour is an identity badge beside a name, never a number.
 *
 * The hex is what goes in `fanta_team.color`, not the name: a palette that gains
 * or loses a tint later must not repaint the teams of a league already played.
 */
export const TEAM_COLORS = [
  { value: '#F2564D', label: 'corallo' },
  { value: '#E8703A', label: 'ruggine' },
  { value: '#C3D63F', label: 'lime' },
  { value: '#5FC46B', label: 'prato' },
  { value: '#2FBF91', label: 'smeraldo' },
  { value: '#35B5D6', label: 'ciano' },
  { value: '#4A8CF0', label: 'azzurro' },
  { value: '#8B7BF0', label: 'indaco' },
  { value: '#C46BE8', label: 'viola' },
  { value: '#EE5FA7', label: 'magenta' },
] as const

/**
 * One item moved inside a list, as a new list.
 *
 * Pure and shared because two very different places do the same move: the wizard,
 * where the teams are not in the database yet and the order is an array, and the
 * optimistic redraw of the teams view while the transaction of `team.reorder`
 * runs. Out-of-range indices return the list unchanged rather than throwing —
 * a drag that ends outside the list is a gesture that did nothing, not an error.
 */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items]
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

/**
 * `desired` if it is exactly `current` in another order, `null` otherwise.
 *
 * The guard `team.reorder` needs, and the reason it is here rather than inline in
 * the service: a reorder that quietly accepted a list missing an id would leave
 * that team with its old `order_index` and produce a duplicate the moment two
 * teams end up on the same number. `UNIQUE (league_id, order_index)` would catch
 * it — from inside a transaction, as `UNKNOWN`, which is the failure mode
 * CLAUDE.md names by hand.
 *
 * Compared as multisets — both sides sorted, then element by element — and not
 * as sets. Membership plus equal length looks like the same check and is not:
 * `[1,1,2]` against `[1,2,2]` has every member on both sides and is not a
 * reordering of it. Written the set way, the guard against that case turned out
 * to be unreachable through the only door callers use, which is the way a test
 * passes while proving nothing.
 */
export function permutationOf(
  current: readonly number[],
  desired: readonly number[],
): number[] | null {
  if (current.length !== desired.length) return null
  const a = [...current].sort((x, y) => x - y)
  const b = [...desired].sort((x, y) => x - y)
  return a.every((id, i) => id === b[i]) ? [...desired] : null
}

/**
 * The two coherence checks of document 2 §4.3, step 3, which "lo dice subito,
 * senza bloccare": `squadre × slot` against the players a role actually has, and
 * `budget` against `slot × puntata minima`.
 *
 * Warnings and not refusals. A league with more slots than players is a league
 * whose auction ends with empty benches — unusual, entirely legal, and none of
 * the app's business to forbid.
 *
 * `available` null means no listone is loaded for that season, and then only the
 * budget half runs: saying "0 attaccanti disponibili" when the truth is "nobody
 * has looked" would be a false alarm on the one screen that must not cry wolf.
 */
export type CoherenceWarning =
  | { code: 'NOT_ENOUGH_PLAYERS'; role: ClassicRole; needed: number; available: number }
  | { code: 'BUDGET_BELOW_SLOTS'; budget: number; needed: number }

export function coherenceWarnings(input: {
  teams: number
  slots: Readonly<Record<ClassicRole, number>>
  budget: number
  minBid: number
  available: Readonly<Record<ClassicRole, number>> | null
}): CoherenceWarning[] {
  const warnings: CoherenceWarning[] = []

  if (input.available !== null) {
    for (const role of CLASSIC_ROLES) {
      const needed = input.teams * input.slots[role]
      const available = input.available[role]
      if (needed > available) warnings.push({ code: 'NOT_ENOUGH_PLAYERS', role, needed, available })
    }
  }

  // Every slot has to be fillable at the minimum bid, or the roster cannot be
  // completed at any price — invariant 4 read before a single purchase exists.
  const needed = totalSlots(input.slots) * input.minBid
  if (needed > input.budget) {
    warnings.push({ code: 'BUDGET_BELOW_SLOTS', budget: input.budget, needed })
  }

  return warnings
}

/* ---------------------------------------------------------- the auction */

/**
 * What one team's roster is, arithmetically. Everything the invariants of
 * document 1 §5 need, and nothing else.
 *
 * This is the shape document 6 §3 prescribes, and the reason it exists: "le
 * invarianti che contano davvero — puntata massima, completabilità, slot pieni,
 * crediti residui — sono aritmetica su un oggetto piccolo. **Non hanno bisogno
 * di un database.**" The service reads three numbers out of SQLite and hands
 * them over; the rules live here, where a test on plain Node can reach them.
 */
export type RosterState = {
  /** Credits not yet spent. */
  credits: number
  /** Slots already taken, per role. */
  filled: Readonly<Record<ClassicRole, number>>
  /** Slots the league gives, per role. */
  slots: Readonly<Record<ClassicRole, number>>
}

export function freeSlots(r: RosterState): number {
  return CLASSIC_ROLES.reduce((n, role) => n + (r.slots[role] - r.filled[role]), 0)
}

/**
 * Invariant 5, the signature element of document 2 §2 — "la cifra più grande
 * sullo schermo dopo il nome del giocatore in asta".
 *
 * `crediti − (slot_liberi − 1) × min_bid`, with the guard the invariant names by
 * hand: at zero free slots it is zero, and without that line the formula would
 * return `credits + minBid` — forty credits becoming forty-one on precisely the
 * team that can no longer buy anything.
 *
 * The floor at zero covers the other end. A team cannot get there during an
 * auction, because invariant 4 refuses the purchase that would put it there —
 * but revision can, since invariant 11 lets those violations through as
 * warnings, and a negative maximum bid on screen would be nonsense.
 */
export function maxBid(r: RosterState, minBid: number): number {
  const free = freeSlots(r)
  if (free <= 0) return 0
  return Math.max(0, r.credits - (free - 1) * minBid)
}

/**
 * The four codes an assignment can break. A subset of `ErrorCode` by hand,
 * because `shared/errors.ts` imports this file and the arrow cannot go both
 * ways: the service that raises them turns each into its message.
 */
export type ViolationCode = Violation['code']

/**
 * A violation carries the numbers its message will need, and the union is
 * discriminated so the compiler knows *which* numbers.
 *
 * Not `detail: Record<string, number>`, which is what this was first: on that
 * type `detail.n` is a `number` even when there is no `n`, so renaming a key
 * here would leave the refusal saying "Alfa ha undefined crediti" with the
 * typecheck green and every test passing. The header of shared/errors.ts
 * promises that a missing parameter is a compile error; between the check and
 * the message that promise is only true if this union keeps it.
 */
export type Violation =
  | { code: 'BELOW_MIN_BID'; blocking: boolean; detail: { n: number } }
  | { code: 'ROLE_SLOTS_FULL'; blocking: boolean; detail: { n: number } }
  | { code: 'INSUFFICIENT_CREDITS'; blocking: boolean; detail: { n: number } }
  | { code: 'EXCEEDS_MAX_BID'; blocking: boolean; detail: { max: number; keep: number } }

/**
 * Every rule of merit an assignment has to satisfy, in one function with the
 * severity as a parameter.
 *
 * One function and not two, and that is invariant 11 made testable: during the
 * auction these refuse, in revision they are computed and shown. Two
 * implementations would share the arithmetic on the first day and disagree on
 * some later one — and the one that runs a single evening a year is the one that
 * would be wrong.
 *
 * What is *not* here: invariants 1, 6 and 7 — the same player twice, the slot
 * that must match the role, the player from another season. Document 1 §5 calls
 * them structural and keeps them blocking even in revision, and they need the
 * database to answer, so they stay in the service beside the query that sees
 * them.
 */
export function checkPurchase(
  r: RosterState,
  role: ClassicRole,
  price: number,
  minBid: number,
  severity: 'blocking' | 'advisory',
): Violation[] {
  const blocking = severity === 'blocking'
  const violations: Violation[] = []

  if (price < minBid) {
    violations.push({ code: 'BELOW_MIN_BID', blocking, detail: { n: minBid } })
  }

  // Invariant 3.
  if (r.filled[role] >= r.slots[role]) {
    violations.push({ code: 'ROLE_SLOTS_FULL', blocking, detail: { n: r.filled[role] } })
  }

  /**
   * Invariants 2 and 4, and only one of the two ever speaks.
   *
   * They overlap: a price above the credits is also above the maximum bid, so
   * both would fire and the screen would carry two sentences about the same
   * money. Document 2 §7 gives them separate rows because they answer different
   * questions — "ha 218 crediti" is the blunt fact, "può arrivare a 205" is the
   * precise one — and printed together the precise one makes the problem look
   * like thirteen credits when it is eighty.
   *
   * Invariant 4 is not a third check. Completability says the credits left must
   * cover the free slots at the minimum bid; substitute it into the maximum bid
   * of invariant 5 and it is the same inequality. Writing them separately is how
   * they would come to disagree.
   */
  if (price > r.credits) {
    violations.push({ code: 'INSUFFICIENT_CREDITS', blocking, detail: { n: r.credits } })
  } else {
    const max = maxBid(r, minBid)
    if (price > max) {
      violations.push({
        code: 'EXCEEDS_MAX_BID',
        blocking,
        detail: { max, keep: Math.max(0, freeSlots(r) - 1) * minBid },
      })
    }
  }

  return violations
}

/**
 * The anomalies of a roster at rest, which the panel of document 2 §4.10 groups
 * by team and shows in full.
 *
 * A sibling of `checkPurchase` rather than a reuse of it, because the two answer
 * different questions on the same arithmetic. That one judges a purchase about
 * to happen; this one judges the state revision *finds* a team in. A purchase
 * that violates nothing can leave a team one goalkeeper short, and no violation
 * would ever say so.
 *
 * This is the second half of invariant 11: computed and shown, never blocking.
 * It is what makes the screen usable at all — §4.10, "mentre sposti un giocatore
 * da una squadra all'altra la seconda è per forza sforata per un istante".
 *
 * Discriminated like `Violation`, and for the reason written there: on a
 * `detail: Record<string, number>` every key reads as a `number` whether it is
 * there or not, and the panel would say "sforato di undefined crediti" with the
 * typecheck green.
 */
export type RosterAnomaly =
  | { code: 'OVER_BUDGET'; detail: { n: number } }
  | { code: 'NOT_COMPLETABLE'; detail: { credits: number; slots: number } }
  | { code: 'ROLE_OVER'; role: ClassicRole; detail: { have: number; slots: number } }
  | { code: 'ROLE_MISSING'; role: ClassicRole; detail: { n: number } }

export function rosterAnomalies(r: RosterState, minBid: number): RosterAnomaly[] {
  const anomalies: RosterAnomaly[] = []

  /**
   * Invariants 2 and 4, and only one of the two ever speaks — the same
   * arrangement `checkPurchase` makes for the same overlap. A team past its
   * budget cannot complete its roster either, and both lines together would put
   * two sentences about one problem in a panel whose whole claim is that every
   * line in it is worth reading.
   */
  if (r.credits < 0) {
    anomalies.push({ code: 'OVER_BUDGET', detail: { n: -r.credits } })
  } else {
    /**
     * Nessuna guardia su `free`, e non è una dimenticanza: qui i crediti sono
     * per forza ≥ 0, quindi con zero slot liberi — o meno di zero, che in
     * revisione capita a chi ha un ruolo di troppo — il confronto è già falso da
     * sé. La versione con `free > 0 &&` davanti è passata dal giro delle
     * mutazioni senza che un solo test se ne accorgesse: era una riga che
     * nessun dato poteva raggiungere.
     */
    const free = freeSlots(r)
    if (r.credits < free * minBid) {
      anomalies.push({ code: 'NOT_COMPLETABLE', detail: { credits: r.credits, slots: free } })
    }
  }

  /**
   * Invariant 3 and its mirror, in two passes so that every role over its limit
   * is listed before every role short of it — the order of the panel drawn in
   * §4.10, where "9 difensori su 8" sits above "1 portiere mancante".
   *
   * A role short of its slots is not an invariant at all: nothing forbids it,
   * and during the auction it is the normal state of every team. It is an
   * anomaly *here* because the auction is over and nobody is going to fill it
   * later, which is exactly the difference revision makes.
   */
  for (const role of CLASSIC_ROLES) {
    if (r.filled[role] > r.slots[role]) {
      anomalies.push({
        code: 'ROLE_OVER',
        role,
        detail: { have: r.filled[role], slots: r.slots[role] },
      })
    }
  }
  for (const role of CLASSIC_ROLES) {
    if (r.filled[role] < r.slots[role]) {
      anomalies.push({
        code: 'ROLE_MISSING',
        role,
        detail: { n: r.slots[role] - r.filled[role] },
      })
    }
  }

  return anomalies
}

/**
 * Invariant 8: an auction opens with at least two teams and the slots set.
 *
 * "Gli slot configurati" is read as at least one slot somewhere: a league whose
 * roster is entirely zeroes has nothing to auction, and the wizard cannot
 * produce one — but the rules stay editable until this moment, so somebody can.
 */
export function canStartAuction(input: {
  teams: number
  slots: Readonly<Record<ClassicRole, number>>
}): boolean {
  return input.teams >= 2 && totalSlots(input.slots) > 0
}

/* --------------------------------------- the score, document 1 §6 */

/**
 * How much each past season counts, most recent first.
 *
 * Three because the dataset carries three, and decreasing because a fantamedia
 * from two summers ago describes a different player. Normalised by the weights
 * actually used, not by their total: somebody with one past season gets that
 * season's average, not a third of it.
 */
export const RECENCY_WEIGHTS = [3, 2, 1] as const

/**
 * The counters a season of history carries, as the score reads them.
 *
 * A subset of `player_season_stat` written as nullable everywhere: FBref's four
 * columns are absent when the optional stage never ran, and Fantacalcio's own
 * are absent for a season the player did not play.
 */
export type SeasonCounters = {
  matchesRated: number | null
  avgVote: number | null
  fantaAvg: number | null
  yellowCards: number | null
  redCards: number | null
  ownGoals: number | null
  goalsConceded: number | null
  matchesPlayed: number | null
  starts: number | null
  minutes: number | null
  cleanSheets: number | null
}

const COUNTERS = [
  'matchesRated',
  'avgVote',
  'fantaAvg',
  'yellowCards',
  'redCards',
  'ownGoals',
  'goalsConceded',
  'matchesPlayed',
  'starts',
  'minutes',
  'cleanSheets',
] as const

/**
 * The recent past of a player, as one season.
 *
 * **Every term of the score reads this**, not the season being auctioned, and
 * the reason is a number: on the 2026-27 listone the current season's row is
 * not empty and is not zeros — it carries the **first two matchdays**, for 328
 * players out of 524. Scoring on it made a striker who had scored three goals in
 * his single appearance the best player in Italy by a factor of two, because his
 * `bonus_index` for those ninety minutes was 9.
 *
 * So the window is the same one `FM_attesa` uses: up to three past seasons,
 * weighted towards the recent, a season not played skipped. Averaging the
 * counters and then taking the ratios — rather than averaging the ratios —
 * keeps a season of two appearances from weighing as much as a season of
 * thirty-eight inside the same window.
 *
 * Each field is averaged over the seasons that **have** it, so FBref's columns
 * do not drag towards zero the years before the stage was ever run.
 */
export function pastWindow(
  stats: Readonly<Record<string, Partial<SeasonCounters>>>,
  currentSeasonId: string,
): SeasonCounters | null {
  const past = Object.entries(stats)
    .filter(
      ([id, s]) =>
        // `<` e non `!==`: una stagione **più recente** di quella scelta non è
        // passato. Con due listoni importati il selettore del §4.4 lascia
        // guardare il 2025-26, e `!==` dava alle due giornate del 2026-27 il
        // peso massimo — cioè il difetto appena chiuso, rientrato dalla porta
        // del selettore.
        id < currentSeasonId && (s.matchesRated ?? 0) > 0 && (s.fantaAvg ?? null) !== null,
    )
    // Season ids sort as strings the way they sort as years: '2025-26' > '2024-25'.
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, RECENCY_WEIGHTS.length)

  if (past.length === 0) return null

  const window = {} as SeasonCounters
  for (const field of COUNTERS) {
    let weighted = 0
    let total = 0
    past.forEach(([, season], i) => {
      const value = season[field]
      if (value === null || value === undefined) return
      weighted += RECENCY_WEIGHTS[i] * value
      total += RECENCY_WEIGHTS[i]
    })
    window[field] = total === 0 ? null : weighted / total
  }
  return window
}

/**
 * `FM_attesa`, the first term of §6's formula — which §6 names and does not
 * define.
 *
 * There is no projection model and there will not be one: document 1 §2 puts
 * "previsioni con modelli statistici" outside the v1. So the expectation is the
 * past, weighted towards the recent, and a season the player did not play does
 * not count: `matchesRated` at zero is not a bad average, it is no average.
 *
 * The window `pastWindow` builds, read on one field. What that window excludes
 * and why is written there.
 */
export function expectedFantaAvg(
  stats: Readonly<Record<string, Partial<SeasonCounters>>>,
  currentSeasonId: string,
): number | null {
  return pastWindow(stats, currentSeasonId)?.fantaAvg ?? null
}

/**
 * The six weights of §6's formula, one set per role.
 *
 * Six and not five: §6 writes the formula with five terms and then says that for
 * goalkeepers, with the defence modifier on, `conceded_per_match` counts. It has
 * to enter somewhere, and a term whose weight is zero on every other role
 * changes nothing for them.
 */
export type ScoringWeights = {
  fantaAvg: number
  reliability: number
  bonus: number
  starts: number
  malus: number
  conceded: number
}

/**
 * The defaults, differentiated by role as §6 asks.
 *
 * `fantaAvg` is 1 everywhere on purpose: the score stays **on the scale of a
 * fantamedia**, roughly 5 to 11, so a number in that column can be read against
 * the FM beside it instead of being an index out of nowhere. Everything else
 * adjusts it by at most a couple of points.
 *
 * For goalkeepers the bonus weight is **minus one**, and that is §6's "conta la
 * MV pura" read literally: `FM − (FM − MV)` is the MV. The obvious-looking zero
 * is wrong, and wrong in a way that shows: a goalkeeper's fantamedia already
 * carries the goals he conceded — measured on this dataset, `FM − MV` averages
 * −1.05 across the 34 goalkeepers with a window and tracks `−Gs/Pv` almost
 * exactly — so with the defence modifier on, the sixth term subtracted them a
 * second time. The penalty hit whoever actually played twice and whoever never
 * left the bench not at all, and the column put the reserves on top: a third
 * keeper with one appearance and a quotazione of 1 came out as the most
 * expensive goalkeeper in the listone.
 *
 * Attackers weight the bonus most, which is the other half of §6's line.
 * `conceded` is non-zero only for goalkeepers, and `weightsFor` silences it
 * unless the league plays with the defence modifier.
 *
 * Goalkeepers also weight continuity at twice everyone else's rate, and the
 * number is measured rather than felt. Their scores live in a narrow band —
 * every keeper's fantamedia sits between 5 and 7 — so at 1.5 a good afternoon
 * outweighed a whole season: a third-choice keeper with one appearance, a
 * quotazione of 1 and a clean sheet came third in the listone. At 3 the top of
 * the column is Svilar, Carnesecchi, Maignan, Falcone, De Gea, which is five
 * starters; at 4 nothing improves further. For an outfielder a small sample is
 * a gamble, for a reserve keeper it is nothing at all.
 */
export const DEFAULT_WEIGHTS: Readonly<Record<ClassicRole, ScoringWeights>> = {
  P: { fantaAvg: 1, reliability: 3, bonus: -1, starts: 0.5, malus: 0.5, conceded: 1 },
  D: { fantaAvg: 1, reliability: 1.5, bonus: 0.8, starts: 0.5, malus: 1, conceded: 0 },
  C: { fantaAvg: 1, reliability: 1.5, bonus: 1, starts: 0.5, malus: 0.8, conceded: 0 },
  A: { fantaAvg: 1, reliability: 1.5, bonus: 1.5, starts: 0.5, malus: 0.5, conceded: 0 },
}

/**
 * The weights a league actually uses: its own if it has any, the defaults
 * otherwise, with `conceded` silenced unless the defence modifier is on.
 *
 * A league that overrides one role keeps the defaults for the other three,
 * because a partial override is the normal kind: whoever changes the attackers'
 * bonus weight has no opinion about goalkeepers.
 *
 * `custom` has no caller yet, and that is the deferral T12b's roadmap line
 * makes: its "Serve:" list asks for the defaults, and `league.scoring_weights`
 * — a JSON column that has existed since T11 with nothing reading it — stays
 * unread until something can edit it. The seam is here so that the day it can,
 * the formula does not move.
 */
export function weightsFor(
  role: ClassicRole,
  defenseModifier: boolean,
  custom?: Partial<Record<ClassicRole, Partial<ScoringWeights>>> | null,
): ScoringWeights {
  const base = { ...DEFAULT_WEIGHTS[role], ...(custom?.[role] ?? {}) }
  return defenseModifier ? base : { ...base, conceded: 0 }
}

export type ScoreInput = {
  expectedFantaAvg: number | null
  reliability: number | null
  bonusIndex: number | null
  startShare: number | null
  malusRate: number | null
  concededPerMatch: number | null
}

/**
 * §6's formula, with the sixth term.
 *
 * No expected fantamedia, no score: a player with nothing behind him has nothing
 * to be scored on, and a zero would put him below everyone instead of outside
 * the ranking. The column says so by being empty.
 *
 * Measured on 2026-27: 132 of the 524 have no score. Not 108, which is the
 * number of players with no past row at all — the other 24 have rows for seasons
 * they never played, and a season with no appearances is not a bad average, it
 * is no average.
 *
 * The other five terms contribute zero when they are missing rather than being
 * renormalised away. Renormalising would change the *scale* between a player
 * with FBref data and one without, and the two would stop being comparable in a
 * column sorted by that very number. FBref is all-or-nothing per season, so in
 * practice either everybody has those terms or nobody does.
 */
export function playerScore(input: ScoreInput, w: ScoringWeights): number | null {
  if (input.expectedFantaAvg === null) return null
  const term = (value: number | null, weight: number): number => (value === null ? 0 : value * weight)
  return (
    input.expectedFantaAvg * w.fantaAvg +
    term(input.reliability, w.reliability) +
    term(input.bonusIndex, w.bonus) +
    term(input.startShare, w.starts) -
    term(input.malusRate, w.malus) -
    term(input.concededPerMatch, w.conceded)
  )
}

export type PricedPlayer = {
  id: number
  role: ClassicRole
  score: number | null
  quotazione: number | null
}

export type PriceMarket = {
  budget: number
  teams: number
  slots: Readonly<Record<ClassicRole, number>>
  minBid: number
}

/**
 * `total` split across `weights` as whole numbers that still add up to `total`.
 *
 * Largest remainder: floor everything, then hand the leftovers to whoever lost
 * the most in the flooring. Rounding each share on its own loses or invents
 * credits — on this dataset the drift ran from −5 to +4 depending on how many
 * teams the league has — and a total that only sometimes adds up is worse than
 * one that never does, because it looks right until somebody checks.
 *
 * Ties go to the earlier index, so the same league split twice gives the same
 * numbers. Order is the caller's, and both callers here order by score.
 */
export function shareOut(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0)
  if (sum <= 0) return weights.map(() => 0)

  const exact = weights.map((w) => (total * w) / sum)
  const out = exact.map((v) => Math.floor(v))
  let left = total - out.reduce((n, v) => n + v, 0)

  /**
   * A parità di resto vince l'indice più basso — e senza doverlo dire: l'array
   * è costruito in ordine di indice e `sort` in JavaScript è stabile per
   * specifica. Lo spareggio esplicito `|| a.i - b.i` c'era ed è passato dal
   * giro delle mutazioni senza che un test se ne accorgesse.
   */
  const byRemainder = exact
    .map((v, i) => ({ rest: v - Math.floor(v), i }))
    .sort((a, b) => b.rest - a.rest)

  for (const { i } of byRemainder) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

/**
 * The expected price of §6: the score normalised on the credits available per
 * role. «Non è una previsione, è un riferimento per costruire le fasce.»
 *
 * Three steps, and only the first is a decision. The credits in play are
 * `budget × squadre`. **How they split between roles is the listone's own
 * opinion**, not a table written here: the quotazioni already are what the
 * market thinks a role is worth, summed over the players who will actually be
 * bought — `slot × squadre` of them. A league with eight defenders and one
 * goalkeeper gets a different split from one with three goalkeepers, without
 * anybody choosing percentages.
 *
 * Inside a role, each player takes the share of the pool his score is worth.
 * Below the cut everyone is worth the minimum bid, which is true: those are the
 * players nobody raises for. Whoever has **no score** has no price either — the
 * price is derived from the score, and a confident `1` beside an empty column
 * would be the row claiming to know something it just said it does not.
 *
 * The credits are conserved, and by construction rather than by luck: both
 * splits go through `shareOut`. The only way out is the minimum bid lifting
 * somebody the arithmetic put below it, which adds credits that are not there —
 * rare, and visible, because the sum then exceeds the budget instead of missing
 * it.
 */
export function expectedPrices(
  players: readonly PricedPlayer[],
  market: PriceMarket,
): Map<number, number> {
  const prices = new Map<number, number>()
  const ranked = new Map<ClassicRole, PricedPlayer[]>()
  const quota = new Map<ClassicRole, number>()

  for (const role of CLASSIC_ROLES) {
    const inside = players
      .filter((p) => p.role === role && p.score !== null)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, market.slots[role] * market.teams)
    ranked.set(role, inside)
    quota.set(
      role,
      inside.reduce((n, p) => n + (p.quotazione ?? 0), 0),
    )
  }

  for (const player of players) {
    if (player.score !== null) prices.set(player.id, market.minBid)
  }

  const pools = shareOut(
    market.budget * market.teams,
    CLASSIC_ROLES.map((role) => quota.get(role) as number),
  )

  CLASSIC_ROLES.forEach((role, i) => {
    const inside = ranked.get(role) as PricedPlayer[]
    const shares = shareOut(
      pools[i],
      inside.map((p) => Math.max(0, p.score as number)),
    )
    inside.forEach((p, j) => prices.set(p.id, Math.max(market.minBid, shares[j])))
  })

  return prices
}

/* ------------------------------------------------- objectives and plans */

/**
 * The five tiers of `target.tier`, which the schema constrains with a
 * `CHECK (tier BETWEEN 1 AND 5)`.
 *
 * The column is nullable and the board of document 2 §4.6 has a row for that:
 * the star of §4.4 adds an objective in one gesture, and one gesture cannot also
 * ask which tier. `null` is "marked, not yet placed", and the drag between rows
 * is what turns it into a number.
 */
export const TIERS = [1, 2, 3, 4, 5] as const
export type Tier = (typeof TIERS)[number]

/** The rating of a target, a `CHECK (rating BETWEEN 1 AND 5)` in the schema. */
export const MAX_RATING = 5

/** What the header of a role column says, per document 2 §4.6. */
export type RoleTotals = {
  count: number
  /** Sum of the maximum prices that are set. A target without one adds nothing. */
  maxPriceTotal: number
  /** `maxPriceTotal / budget`, null when there is no budget to weigh against. */
  budgetShare: number | null
}

type TargetLike = { roleClassic: ClassicRole; tier: number | null; maxPrice: number | null }

export function targetTotals(
  targets: readonly TargetLike[],
  budget: number,
): Record<ClassicRole, RoleTotals> {
  const totals = {} as Record<ClassicRole, RoleTotals>
  for (const role of CLASSIC_ROLES) {
    const mine = targets.filter((t) => t.roleClassic === role)
    const maxPriceTotal = mine.reduce((sum, t) => sum + (t.maxPrice ?? 0), 0)
    totals[role] = {
      count: mine.length,
      maxPriceTotal,
      budgetShare: budget > 0 ? maxPriceTotal / budget : null,
    }
  }
  return totals
}

/**
 * The warning document 2 §4.6 asks for by name: "se la somma dei prezzi massimi
 * dei tuoi obiettivi di fascia 1 supera il budget, l'app lo dice, perché è
 * esattamente l'errore che si fa preparando l'asta".
 *
 * Across every role and not per role, which is what makes it the error it
 * describes: eight first-choice players are affordable one department at a time
 * and unaffordable together. Null when there is nothing to say.
 */
export function tierOneOverBudget(
  targets: readonly TargetLike[],
  budget: number,
): { total: number; budget: number } | null {
  const total = targets
    .filter((t) => t.tier === 1)
    .reduce((sum, t) => sum + (t.maxPrice ?? 0), 0)
  return total > budget ? { total, budget } : null
}

/** What the bar of document 2 §4.7 shows above a plan. */
export type PlanTotals = {
  spent: number
  remaining: number
  slotsTotal: number
  slotsFilled: number
  slotsLeft: number
  /**
   * `remaining / slotsLeft` — "media disponibile per slot rimanente, che è il
   * numero che dice se il piano regge".
   *
   * Null on a full roster rather than zero, and the guard is the same one
   * invariant 5 puts on the maximum bid: dividing by no slots at all is not a
   * small average, it is a question with no meaning. Callers show an em dash.
   */
  perSlot: number | null
}

type PlanItemLike = { slotRole: ClassicRole; estPrice: number }

export function planTotals(
  items: readonly PlanItemLike[],
  slots: Readonly<Record<ClassicRole, number>>,
  budget: number,
): PlanTotals {
  const spent = items.reduce((sum, item) => sum + item.estPrice, 0)
  const remaining = budget - spent
  const slotsTotal = totalSlots(slots)
  // Counted against the grid, not against the list: an item beyond its role's
  // slots occupies no cell, so it must not consume one in the arithmetic either.
  const cells = planCells(items, slots)
  const slotsFilled = CLASSIC_ROLES.reduce((sum, role) => sum + cells[role].filled.length, 0)
  const slotsLeft = slotsTotal - slotsFilled
  return {
    spent,
    remaining,
    slotsTotal,
    slotsFilled,
    slotsLeft,
    perSlot: slotsLeft > 0 ? remaining / slotsLeft : null,
  }
}

/**
 * The grid of document 2 §4.7, role by role: which cells are filled, how many
 * are empty, and who is left over.
 *
 * The overflow is not a defensive nicety. Invariant 16 lets the slots be edited
 * for as long as the league is in `setup` or `pre_auction`, so a plan built on
 * eight defenders survives the day someone sets defenders to six. Two items then
 * belong to no cell, and the alternatives are both worse than showing them: the
 * grid would drop two players without saying so, or `planTotals` would count a
 * roster as fuller than the grid can draw.
 *
 * Order inside a role is the order given, which is `priority` as the database
 * returns it — the plan reads the way it was built.
 */
export function planCells<T extends PlanItemLike>(
  items: readonly T[],
  slots: Readonly<Record<ClassicRole, number>>,
): Record<ClassicRole, { filled: T[]; empty: number; overflow: T[] }> {
  const cells = {} as Record<ClassicRole, { filled: T[]; empty: number; overflow: T[] }>
  for (const role of CLASSIC_ROLES) {
    const mine = items.filter((item) => item.slotRole === role)
    const filled = mine.slice(0, slots[role])
    cells[role] = {
      filled,
      // No guard against a negative: `filled` comes out of a slice on
      // `slots[role]`, so it can never be longer than the cap and the difference
      // never goes below zero. A `Math.max(0, …)` here would be a line no data
      // can reach — and no test would notice it was never reached.
      empty: slots[role] - filled.length,
      overflow: mine.slice(slots[role]),
    }
  }
  return cells
}
