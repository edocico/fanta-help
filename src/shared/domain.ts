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
