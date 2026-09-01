import uFuzzy from '@leeoniya/ufuzzy'
import { normalizeName } from '@shared/domain'
import type { PlayerRow } from '@shared/types'

/**
 * The fuzzy search of document 2 §4.4: in memory, filtering while you type,
 * no button and no wait.
 *
 * It searches the *normalised* names, through the very function that wrote
 * `player.name_normalized` in the database. That is not tidiness: uFuzzy matches
 * literally, so `vlahovic` typed on an Italian keyboard would never reach
 * `Vlahović`, and `ndicka` would never reach `N'Dicka`. Normalising both ends
 * with one function is what makes the two agree — the same argument that put
 * `normalizeName` in shared/ rather than beside its callers.
 */

/**
 * uFuzzy's SingleError mode: one typo per term, of any kind.
 *
 * Left at its defaults uFuzzy tolerates **nothing**: `intraIns`, `intraSub`,
 * `intraTrn` and `intraDel` all default to null and resolve to `intraMode`, which
 * is 0. Measured against a haystack of one, `dimarco`:
 *
 *   defaults          dimarko ✗   dimarrco ✗   dimraco ✗   dimaro ✗
 *   intraIns alone    dimarko ✗   dimarrco ✗   dimraco ✗   dimaro ✓
 *   the five below    dimarko ✓   dimarrco ✓   dimraco ✓   dimaro ✓
 *
 * Which is why the mode matters and why leaving it out looks like a search that
 * simply finds less rather than a misconfigured one. One error per term is the
 * right ceiling for a list you scan by eye: past it the results stop resembling
 * what was typed.
 */
const uf = new uFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1 })

export type Haystack = {
  players: readonly PlayerRow[]
  needles: string[]
}

/**
 * Rebuilt only when the list changes, never per keystroke.
 *
 * Each entry carries the name twice: as written, and with the spaces closed up.
 * uFuzzy splits the needle on spaces and matches each term inside one word, so
 * `debruyne` typed in a hurry would otherwise find nothing while `de bruyne`,
 * `bruyne` and even `bruynee` all work. Doubling the haystack is a kilobyte and
 * closes the whole family: `zepedro`, `martinezl`, `deroon`.
 */
export function haystack(players: readonly PlayerRow[]): Haystack {
  return {
    players,
    needles: players.map((p) => {
      const name = normalizeName(p.name)
      const closed = name.replace(/ /g, '')
      return closed === name ? name : `${name} ${closed}`
    }),
  }
}

/**
 * The subset matching `query`, ranked by uFuzzy, or the whole list when the box
 * is empty. Returns the players themselves rather than indices so the caller
 * cannot pair them with the wrong haystack.
 */
export function search(index: Haystack, query: string): PlayerRow[] {
  const needle = normalizeName(query)
  if (needle === '') return [...index.players]

  const [indices, info, order] = uf.search(index.needles, needle)
  if (!indices) return []

  // `info`/`order` are absent above uFuzzy's internal threshold, where it stops
  // ranking and only filters. Falling back to the filtered order keeps the list
  // useful instead of empty.
  if (!info || !order) return indices.map((i) => index.players[i])
  return order.map((position) => index.players[info.idx[position]])
}
