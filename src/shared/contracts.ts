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
 * One row of the players view of document 2 §4.4.
 *
 * The whole season arrives in one call and the renderer does the rest: document
 * 2 §4.4 asks for fuzzy search "mentre digiti, senza pulsante e senza attesa"
 * over a virtualised table, and a round trip per keystroke cannot answer that.
 * Six hundred rows of this are a few hundred kilobytes.
 *
 * The derived metrics of document 1 §6 are **not** here. They are pure functions
 * of these numbers, they live in shared/domain.ts, and sending them too would
 * mean two places that could disagree about what `FM − MV` is.
 */
const seasonStats = z.object({
  matchesRated: z.number().int().nullable(),
  avgVote: z.number().nullable(),
  fantaAvg: z.number().nullable(),
  goalsConceded: z.number().int().nullable(),
  yellowCards: z.number().int().nullable(),
  redCards: z.number().int().nullable(),
  ownGoals: z.number().int().nullable(),
  // The four FBref columns, null unless the optional stage ran.
  matchesPlayed: z.number().int().nullable(),
  starts: z.number().int().nullable(),
  minutes: z.number().int().nullable(),
  cleanSheets: z.number().int().nullable(),
})

const playerRow = z.object({
  id: z.number().int(),
  name: z.string(),
  roleClassic: ROLE,
  /** Badges under the name, per document 2 §4.4: never a column of their own. */
  rolesMantra: z.array(z.string()),
  teamName: z.string(),
  teamCode: z.string().nullable(),
  qtClassicCurrent: z.number().nullable(),
  qtClassicInitial: z.number().nullable(),
  fvmClassic: z.number().nullable(),
  penaltyTaker: z.boolean(),
  /** Gone from the listone but still in the database — invariant 10. */
  delisted: z.boolean(),
  /**
   * His whole history, keyed by season. Empty for a débutant, or for a player
   * the reconciliation could not hang a past on.
   *
   * All of it travels, rather than the one season the table happens to show,
   * so the season selector switches columns without a round trip — the same
   * reason the whole listone arrives at once. It is 1400 rows for a full
   * dataset, a few hundred kilobytes.
   */
  stats: z.record(z.string(), seasonStats),
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

  /**
   * The whole season, once. Filtering, sorting and the fuzzy search happen in the
   * renderer — see `playerRow`.
   *
   * The T4 version took `role`, `search` and friends and filtered with SQL
   * `LIKE`. Two reasons it could not stay. A round trip per keystroke cannot
   * answer "senza attesa percepibile", and `LIKE` does not tolerate a typo:
   * `%dimarko%` matches nothing, while the fuzzy search finds Dimarco. Keeping
   * both would have meant two searches that disagree about the same listone.
   */
  'player.list': {
    input: z.object({ seasonId: z.string() }),
    output: z.object({
      seasonId: z.string(),
      /** Drives the FBref columns, per document 2 §4.4 and document 1 §6. */
      hasFbref: z.boolean(),
      /** Seasons with statistics, oldest first: what the selector offers. */
      statsSeasons: z.array(z.string()),
      /**
       * The last **completed** season, which is what the table shows until the
       * reader picks another. An auction is prepared in August, when the season
       * on screen has two matchdays in it: its FM and MV would say nothing, and
       * the "Pv ≥ 25 su 38" chip of document 2 §4.4 would select nobody.
       */
      defaultStatsSeason: z.string().nullable(),
      players: z.array(playerRow),
    }),
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
