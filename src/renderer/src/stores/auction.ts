import { create } from 'zustand'

/**
 * The ephemeral state of the assignment flow, exactly as document 3 §4 lists it:
 * "giocatore selezionato, prezzo digitato, squadra scelta, passo corrente del
 * flusso".
 *
 * A store and not component state, for the reason the same section gives: "se la
 * mutazione fallisce lo store resta com'è, così puoi correggere il prezzo senza
 * ridigitare il nome". Component state would satisfy that today and stop
 * satisfying it in T15, where the projection mode unmounts the assignment panel
 * — and a half-typed price would be lost by glancing at the projector.
 *
 * Nothing here survives a restart, which is the rule that decides what may live
 * in a store at all. It does not need to: document 2 §7 ends by saying every
 * purchase is a transaction committed immediately, so "non esiste uno stato «in
 * corso» da perdere".
 */

export type Step = 'player' | 'price' | 'team'

type AuctionStore = {
  /**
   * Which league the draft belongs to. Opening another league's auction with a
   * name half typed for this one would offer to sell a player to a team that is
   * not in the room.
   */
  leagueId: number | null
  step: Step
  query: string
  /** Index into the visible results. The chosen row is resolved from it. */
  highlight: number
  /**
   * An id and not the row, for the same reason `players.selectedPlayerId` is an
   * id: the rows are rebuilt on every keystroke, and holding one would pin a
   * stale copy of a player the next import could have repriced.
   */
  chosenPlayerId: number | null
  /** Digits as typed, so an empty field is distinguishable from a price of 0. */
  price: string
  teamDraft: string
  teamHighlight: number

  setQuery: (query: string) => void
  setHighlight: (highlight: number) => void
  choose: (playerId: number, team: string) => void
  setPrice: (price: string) => void
  setTeam: (teamDraft: string) => void
  setTeamHighlight: (teamHighlight: number) => void
  setStep: (step: Step) => void
  /** `Esc`, and every successful assignment: back to an empty search box. */
  reset: () => void
  /** Called by the view on mount; clears a draft left over from another league. */
  open: (leagueId: number) => void
}

const EMPTY = {
  step: 'player' as Step,
  query: '',
  highlight: 0,
  chosenPlayerId: null,
  price: '',
  teamDraft: '',
  teamHighlight: 0,
}

export const useAuctionStore = create<AuctionStore>((set) => ({
  leagueId: null,
  ...EMPTY,

  setQuery: (query) =>
    set((s) => ({
      query,
      highlight: 0,
      // Typing again abandons whoever was chosen: the flow restarts rather than
      // leaving a price attached to a name that has left the screen.
      ...(s.chosenPlayerId === null ? {} : { chosenPlayerId: null, step: 'player' as Step }),
    })),
  setHighlight: (highlight) => set({ highlight }),
  // The team arrives with the player because document 2 §5 wants the field
  // "già precompilata con quella di turno" by the time the focus gets there.
  choose: (chosenPlayerId, teamDraft) =>
    set({ chosenPlayerId, teamDraft, teamHighlight: 0, price: '', step: 'price' }),
  setPrice: (price) => set({ price }),
  setTeam: (teamDraft) => set({ teamDraft, teamHighlight: 0 }),
  setTeamHighlight: (teamHighlight) => set({ teamHighlight }),
  setStep: (step) => set({ step }),
  reset: () => set(EMPTY),
  open: (leagueId) => set((s) => (s.leagueId === leagueId ? {} : { leagueId, ...EMPTY })),
}))
