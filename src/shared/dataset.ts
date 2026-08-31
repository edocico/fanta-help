import { z } from 'zod'
import { CLASSIC_ROLES, MANTRA_ROLES } from './domain'

/**
 * The interchange format of document 4 §4, defined once.
 *
 * Both ends live on it: the offline pipeline writes it, and the import of T7
 * validates it with these very schemas before touching the database — which is
 * step 4 of document 4 §6. Two descriptions of this shape would be one
 * description and one guess.
 *
 * Nothing here depends on Node or the DOM: rule 3, checked by both tsconfigs.
 */

export const DATASET_FORMAT = 'fanta-help/dataset'
export const MANIFEST_FORMAT = 'fanta-help/manifest'
export const FORMAT_VERSION = 1

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'non è un digest sha256')
const seasonId = z.string().regex(/^\d{4}-\d{2}$/, "non è una stagione nella forma '2026-27'")
const version = z.string().regex(/^v\d+$/, "non è una versione nella forma 'v4'")

/** Where a number came from, so a strange value can be traced to its file. */
export const datasetSource = z.object({
  kind: z.enum(['quotazioni', 'statistiche', 'fbref']),
  season: seasonId.optional(),
  file: z.string(),
  sha256,
})

export const datasetPlayer = z.object({
  sourceId: z.number().int(),
  identityKey: z.string(),
  name: z.string(),
  team: z.string(),
  roleClassic: z.enum(CLASSIC_ROLES),
  rolesMantra: z.array(z.enum(MANTRA_ROLES)),
  qtClassicInitial: z.number().nullable(),
  qtClassicCurrent: z.number().nullable(),
  qtMantraInitial: z.number().nullable(),
  qtMantraCurrent: z.number().nullable(),
  fvmClassic: z.number().nullable(),
  fvmMantra: z.number().nullable(),
  // Two fields and not one, because the two sources answer different questions.
  // FBref's league tables carry `Born`, a four-digit **year**; the full date is on
  // each player's own page, which the pipeline does not fetch. A single field
  // holding sometimes four characters and sometimes ten would make every reader
  // measure a string before trusting it, and an equality between '1997' and
  // '1997-08-22' would quietly be false.
  birthDate: z.string().nullable(), // hand-written in overrides.json, when it matters
  birthYear: z.number().int().nullable(), // FBref, null without the optional stage
  penaltyTaker: z.boolean(),
  penaltyTakerSource: z.enum(['derived', 'manual']).nullable(),
  externalIds: z
    .object({ fbref: z.string().optional(), apiFootball: z.number().int().optional() })
    .optional(),
})

export const datasetStat = z.object({
  identityKey: z.string(),
  seasonId,
  team: z.string(),
  roleClassic: z.enum(CLASSIC_ROLES),
  matchesRated: z.number().int(), // 'Pv': matches with a vote, not appearances
  // Null, not zero, when there is no rated match: see the note in fantacalcio.ts.
  avgVote: z.number().nullable(),
  fantaAvg: z.number().nullable(),
  goals: z.number().int(),
  goalsConceded: z.number().int(),
  assists: z.number().int(),
  penaltiesTaken: z.number().int(),
  penaltiesScored: z.number().int(),
  penaltiesMissed: z.number().int(),
  penaltiesSaved: z.number().int(),
  yellowCards: z.number().int(),
  redCards: z.number().int(),
  ownGoals: z.number().int(),
  // The four FBref columns. Null until the optional stage of T6 has run.
  matchesPlayed: z.number().int().nullable(),
  starts: z.number().int().nullable(),
  minutes: z.number().int().nullable(),
  cleanSheets: z.number().int().nullable(),
})

export const dataset = z.object({
  format: z.literal(DATASET_FORMAT),
  formatVersion: z.literal(FORMAT_VERSION),
  seasonId,
  version,
  generatedAt: z.string(),
  hasFbref: z.boolean(),
  hasExternalIds: z.boolean(),
  sources: z.array(datasetSource),
  serieATeams: z.array(z.object({ name: z.string(), code: z.string() })),
  players: z.array(datasetPlayer),
  stats: z.array(datasetStat),
})

export const manifestVersion = z.object({
  version,
  publishedAt: z.string(),
  playerCount: z.number().int(),
  hasFbref: z.boolean(),
  hasExternalIds: z.boolean(),
  url: z.string(),
  sha256,
  note: z.string().optional(),
})

export const manifest = z.object({
  format: z.literal(MANIFEST_FORMAT),
  formatVersion: z.literal(FORMAT_VERSION),
  seasons: z.array(
    z.object({
      seasonId,
      label: z.string(),
      latest: version,
      versions: z.array(manifestVersion),
    }),
  ),
})

export type DatasetSource = z.infer<typeof datasetSource>
export type DatasetPlayer = z.infer<typeof datasetPlayer>
export type DatasetStat = z.infer<typeof datasetStat>
export type Dataset = z.infer<typeof dataset>
export type Manifest = z.infer<typeof manifest>
export type ManifestVersion = z.infer<typeof manifestVersion>
