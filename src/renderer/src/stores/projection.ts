import { create } from 'zustand'

/**
 * Projection mode, document 2 §4.9 — and document 3 §4, which lists "il modo
 * proiezione" by name among the ephemeral interface state Zustand holds.
 *
 * A store of its own rather than a field on the auction store, and the auction
 * store's own docblock is the reason: what lives there is *the draft* —
 * "giocatore selezionato, prezzo digitato, squadra scelta, passo corrente del
 * flusso" — and `reset()` throws all of it away on every `Esc` and after every
 * purchase. This has to survive exactly those two events. Added next to the
 * draft it would sit one careless line away from `EMPTY`, where a keystroke that
 * has nothing to do with the projector would switch the projector off.
 *
 * There is one window and one of these, so no league id: the auction view is the
 * only screen that reads it, and it cannot show two leagues at once.
 */

type ProjectionStore = {
  on: boolean
  toggle: () => void
  /**
   * Leaving the auction leaves the mode.
   *
   * Called from the cleanup of the live view, so coming back to the auction an
   * hour later starts on the screen you can type into. A display mode that
   * outlived the screen it belongs to would greet you, on the one evening
   * without time, with a board and no search box and no memory of why.
   */
  leave: () => void
}

export const useProjectionStore = create<ProjectionStore>((set) => ({
  on: false,
  toggle: () => set((s) => ({ on: !s.on })),
  leave: () => set({ on: false }),
}))
