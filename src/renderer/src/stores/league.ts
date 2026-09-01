import { create } from 'zustand'

/**
 * Which league the app is looking at, per document 2 §3: "selettore lega in
 * alto", and the sidebar under it lists that league's sections.
 *
 * Ephemeral on purpose, like everything else in a store. It is a view state, not
 * a preference: the route is the truth while a league view is open, and this only
 * remembers the choice for the screens that have no league in their URL — the
 * players view, which document 2 §9 says "mostra la stagione della lega aperta,
 * o la più recente importata".
 *
 * Which means it is forgotten on restart, and the selector falls back to the
 * most recently touched league. Making it survive would need a settings row in
 * the main process, and settings are T21.
 */

type LeagueStore = {
  activeLeagueId: number | null
  setActiveLeague: (id: number | null) => void
}

export const useLeagueStore = create<LeagueStore>((set) => ({
  activeLeagueId: null,
  setActiveLeague: (activeLeagueId) => set({ activeLeagueId }),
}))
