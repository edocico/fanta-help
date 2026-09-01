import { z } from 'zod'
import { CLASSIC_ROLES } from './domain'

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

const ROLE = z.enum(CLASSIC_ROLES)

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

/**
 * What an import did, per document 4 §6. `upToDate` is the answer to step 2 —
 * `latest` already installed — and when it is true every count below is zero and
 * no backup was taken.
 */
const importReport = z.object({
  seasonId: z.string(),
  version: z.string(),
  upToDate: z.boolean(),
  added: z.number().int(),
  updated: z.number().int(),
  /** Marked with `delisted_at`, never removed: invariant 10. */
  delisted: z.number().int(),
  restored: z.number().int(),
  teams: z.number().int(),
  stats: z.number().int(),
  backup: z.string().nullable(),
  hasFbref: z.boolean(),
  hasExternalIds: z.boolean(),
})

/**
 * An AppError travelling as *data* rather than as a refusal.
 *
 * Only the XLSX preview needs this: it succeeds while reporting that the file it
 * read cannot be imported. `code` is typed as a plain string here because the
 * authoritative list is `ErrorCode` in shared/errors.ts and this end only ever
 * echoes what the main process built there — validating the spelling of a string
 * the main process just produced would be theatre.
 */
const appErrorShape = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

/** What an .xlsx would do if imported, per document 2 §4.1 and document 4 §6. */
const listonePreview = z.object({
  file: z.string(),
  /** Only ever a proposal: the file does not say its season reliably. */
  seasonGuess: z.string().nullable(),
  seasons: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      /** History rows this season already has. An XLSX import leaves them alone. */
      stats: z.number().int(),
    }),
  ),
  headerRow: z.number().int().nullable(),
  recognised: z.array(z.string()),
  /** Columns the file has and the app ignores: how a changed file announces itself. */
  unrecognised: z.array(z.string()),
  missing: z.array(z.string()),
  validRows: z.number().int(),
  rejected: z.array(z.string()),
  rejectedTotal: z.number().int(),
  duplicates: z.array(z.number().int()),
  /** Null when the file can be imported as it stands. */
  refusal: appErrorShape.nullable(),
})

const listoneReport = z.object({
  seasonId: z.string(),
  label: z.string(),
  seasonCreated: z.boolean(),
  added: z.number().int(),
  updated: z.number().int(),
  delisted: z.number().int(),
  restored: z.number().int(),
  teams: z.number().int(),
  backup: z.string(),
  /** Left untouched: the quotazioni file has no statistics in it. */
  statsUntouched: z.number().int(),
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

  /**
   * `dir` is the folder holding `manifest.json`, which the download of T7b will
   * replace with the fixed URL of document 4 §9. Until then it is the only way to
   * point the app at a dataset, and it is why this channel takes a path at all.
   */
  'dataset.import': {
    input: z.object({ dir: z.string(), seasonId: z.string().optional() }),
    output: importReport,
  },

  /** Opens the native file dialog in the main process. Null if it was cancelled. */
  'listone.pick': {
    input: z.void(),
    output: z.object({ filePath: z.string() }).nullable(),
  },

  'listone.preview': {
    input: z.object({ filePath: z.string() }),
    output: listonePreview,
  },

  'listone.import': {
    input: z.object({
      filePath: z.string(),
      // Refused here, before the service is ever called: `season.id` is a primary
      // key that `league` and `player` reference and that nothing in the app
      // deletes, so a typo confirmed once stays for good. The service checks
      // again — this is the outer of the two, not the only one.
      seasonId: z.string().regex(/^\d{4}-\d{2}$/, "non è una stagione nella forma '2026-27'"),
    }),
    output: listoneReport,
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
 * Only one for now. `dataset.progress` is emitted by the import service of T7,
 * five times per run. `update.status` arrives with T20, from document 3 §8 —
 * inventing its shape here without reading that section would be guessing.
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
