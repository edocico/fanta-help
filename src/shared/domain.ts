/**
 * Pure domain functions: roles, calculations, constants. No Node, no DOM, no
 * database — compiled by both tsconfigs, usable from the main process, the
 * renderer and the offline pipeline in tools/.
 *
 * The auction invariants land here in T13, as document 6 §3 prescribes.
 */

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
 * T5 puts the four cases above under test, per document 6 §7. Until then this
 * function is unguarded.
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
