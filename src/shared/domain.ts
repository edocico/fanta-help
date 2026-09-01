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
