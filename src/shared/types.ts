import type { Input, Output } from './contracts'

/**
 * DTOs, derived from the contract schemas and never rewritten beside them: if a
 * channel changes shape, TypeScript breaks on both sides at the same moment.
 *
 * Nothing here may depend on Node or the DOM — this file is compiled by both
 * tsconfig.node.json and tsconfig.web.json, which turns rule 3 into a compile
 * error rather than a promise.
 */

export type AppInstance = Output<'app.instance'>
export type SeasonSummary = Output<'dataset.list'>[number]
export type PlayerList = Output<'player.list'>
export type PlayerRow = PlayerList['players'][number]
/** One season of a player's history. `PlayerRow['stats']` is these, keyed by season. */
export type SeasonStats = PlayerRow['stats'][string]

/** One row of the home, document 2 §4.2. */
export type LeagueSummary = Output<'league.list'>[number]
/**
 * A league with its teams and slots. `league.get` answers with null for an id
 * that names nothing, and every screen here has already dealt with that case —
 * hence the NonNullable rather than a second nullable type travelling around.
 */
export type LeagueDetail = NonNullable<Output<'league.get'>>
export type FantaTeam = LeagueDetail['teams'][number]
export type SlotsByRole = LeagueDetail['slots']
/** A team the wizard is still collecting: no id, because nothing is written yet. */
export type TeamDraft = Input<'league.create'>['teams'][number]

/** One tile of the objectives board, document 2 §4.6. */
export type TargetRow = Output<'target.list'>[number]
/** A plan with its cells, document 2 §4.7. */
export type PlanDetail = Output<'plan.list'>[number]
export type PlanItemRow = PlanDetail['items'][number]

/** Everything the auction screen of document 2 §4.8 consumes. */
export type AuctionState = NonNullable<Output<'auction.state'>>
export type AuctionTeam = AuctionState['teams'][number]
export type AuctionLogEntry = Output<'auction.history'>[number]

/** Una versione cristallizzata nella barra del documento 2 §4.11. */
export type SnapshotSummary = Output<'snapshot.list'>[number]
/** La stessa col file dentro: `snapshot.get` risponde null per una lega che non ne ha. */
export type SnapshotDetail = NonNullable<Output<'snapshot.get'>>
