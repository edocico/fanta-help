import { create } from 'zustand'
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import type { ClassicRole } from '@shared/domain'

/**
 * The ephemeral state of the players view, per document 3 §4: "i filtri attivi".
 *
 * Nothing here survives a restart, which is the rule that decides what may live
 * in a store at all — if it had to still be there after an accidental close, it
 * would belong to the main process.
 *
 * The two season fields hold an **override**, not the current value: null means
 * "whatever the data says", so the view can fall back to the most recent import
 * and the last completed season without an effect that writes back what it just
 * read. Choosing a season explicitly is what turns them into a real value, and
 * `setSeasonId` drops the statistics override with it — a season picked for one
 * listone need not exist in the next.
 */

export type Filters = {
  role: ClassicRole | null
  team: string | null
  mantra: string | null
  minPv: number | null
  penaltyTakers: boolean
}

export const NO_FILTERS: Filters = {
  role: null,
  team: null,
  mantra: null,
  minPv: null,
  penaltyTakers: false,
}

type PlayersStore = {
  seasonId: string | null
  statsSeason: string | null
  query: string
  filters: Filters
  sorting: SortingState
  /**
   * The row whose panel is open, document 2 §4.5. An id and not the row itself:
   * the rows are rebuilt on every keystroke of the search, and holding one would
   * pin a stale copy of a player the next import could have repriced.
   */
  selectedPlayerId: number | null

  setSeasonId: (seasonId: string) => void
  setStatsSeason: (seasonId: string) => void
  setQuery: (query: string) => void
  patchFilters: (patch: Partial<Filters>) => void
  /**
   * Typed as TanStack's own `OnChangeFn`, which hands over either the new value
   * or a function of the old one. Accepting only the value compiles until the
   * table decides to send an updater — which it does for every header click.
   */
  setSorting: OnChangeFn<SortingState>
  select: (playerId: number | null) => void
  reset: () => void
}

export const usePlayersStore = create<PlayersStore>((set) => ({
  seasonId: null,
  statsSeason: null,
  query: '',
  filters: NO_FILTERS,
  selectedPlayerId: null,
  // Document 2 §4.4: "l'ordinamento predefinito è per quotazione decrescente".
  sorting: [{ id: 'qt', desc: true }],

  setSeasonId: (seasonId) => set({ seasonId, statsSeason: null, selectedPlayerId: null }),
  setStatsSeason: (statsSeason) => set({ statsSeason }),
  setQuery: (query) => set({ query }),
  patchFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setSorting: (updater) =>
    set((s) => ({ sorting: typeof updater === 'function' ? updater(s.sorting) : updater })),
  select: (selectedPlayerId) => set({ selectedPlayerId }),
  /** The "azzera" button: filters and search, not the season being looked at. */
  reset: () => set({ filters: NO_FILTERS, query: '' }),
}))
