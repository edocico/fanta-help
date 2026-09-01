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
