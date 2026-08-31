import { z } from 'zod'

/**
 * The single map of channel → input/output schema, per document 3 §3.
 *
 * Not tRPC: forty request/response channels and no complex subscriptions do not
 * justify two layers of abstraction. What matters — shared types, runtime
 * validation, uniform errors — a typed map gives in fifty lines.
 *
 * Types are derived from the schemas, never rewritten alongside them.
 */

type Contract = { input: z.ZodType; output: z.ZodType }
export type ContractMap = Record<string, Contract>

const ROLE = z.enum(['P', 'D', 'C', 'A'])

/** Identity of this installation plus where it keeps its data. */
const appInstance = z.object({
  uuid: z.string(),
  label: z.string().nullable(),
  version: z.string(),
  databasePath: z.string(),
  foreignKeys: z.boolean(),
})

/** One imported season. `dataset.list` answers with these. */
const seasonSummary = z.object({
  id: z.string(),
  label: z.string(),
  datasetVersion: z.string(),
  source: z.string(),
  hasFbref: z.boolean(),
  importedAt: z.number().int(),
})

/**
 * Minimal row for the players view. T9 builds the real one from document 2 §4.4
 * with the derived metrics; this is what the schema can already answer with.
 */
const playerRow = z.object({
  id: z.number().int(),
  name: z.string(),
  roleClassic: ROLE,
  teamName: z.string(),
  qtClassicCurrent: z.number().nullable(),
  fvmClassic: z.number().nullable(),
  /** Already bought in the league passed as `leagueId`; false when none was. */
  owned: z.boolean(),
})

export const contracts = {
  'app.instance': {
    input: z.void(),
    output: appInstance,
  },

  'dataset.list': {
    input: z.void(),
    output: z.array(seasonSummary),
  },

  'player.list': {
    input: z.object({
      seasonId: z.string(),
      leagueId: z.number().int().optional(), // to mark the ones already bought
      role: ROLE.optional(),
      mantraRole: z.string().optional(),
      serieATeamId: z.number().int().optional(),
      search: z.string().optional(),
    }),
    output: z.array(playerRow),
  },
} as const satisfies ContractMap

export type Channel = keyof typeof contracts
export type Input<C extends Channel> = z.infer<(typeof contracts)[C]['input']>
export type Output<C extends Channel> = z.infer<(typeof contracts)[C]['output']>

/**
 * Topics the main process pushes without being asked. Parallel to the channels
 * and typed the same way.
 *
 * Only one for now, and nothing emits it yet: `dataset.progress` belongs to the
 * import of T7. `update.status` arrives with T20, from document 3 §8 — inventing
 * its shape here without reading that section would be guessing.
 */
export type EventMap = Record<string, z.ZodType>

export const events = {
  'dataset.progress': z.object({
    done: z.number().int(),
    total: z.number().int(),
    label: z.string(),
  }),
} as const satisfies EventMap

export type EventTopic = keyof typeof events
export type EventPayload<T extends EventTopic> = z.infer<(typeof events)[T]>
