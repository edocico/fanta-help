import type { TargetRow } from '@shared/types'

/**
 * The board of the open league as the two screens of document 2 §4.4 and §4.5
 * need it: what a player already is, and the two calls that change it.
 *
 * In a module of its own and not beside either of them, because the players view
 * already imports the detail panel — declaring it in one and importing it into
 * the other would close a cycle. Types are erased, so the cycle would compile
 * and mean nothing, which is precisely why it is worth not writing.
 *
 * `null` in place of one of these is the answer when no league is open, and it
 * is what hides the star and the objective block rather than disabling them.
 */
export type Objectives = {
  of: (playerId: number) => TargetRow | null
  /** Absent fields are left alone, null clears them — see `target.upsert`. */
  patch: (input: {
    playerId: number
    tier?: number | null
    maxPrice?: number | null
    rating?: number | null
    note?: string | null
  }) => void
  remove: (playerId: number) => void
}
