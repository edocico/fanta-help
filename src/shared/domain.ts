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
