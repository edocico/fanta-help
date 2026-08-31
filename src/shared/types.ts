import type { Output } from './contracts'

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
export type PlayerRow = Output<'player.list'>[number]
