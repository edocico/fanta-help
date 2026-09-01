import { z } from 'zod'
import { CLASSIC_ROLES, MANTRA_ROLES } from './domain'
import { missingColumns, type Sheet } from './sheet'

/**
 * The listone of Fantacalcio.it, as a shape and a set of refusals.
 *
 * Two programs read this file and they must read it identically: the offline
 * pipeline of T5, and the in-app import of T8 that exists so the app still works
 * when the dataset repo is out of reach. Two descriptions of one file would be
 * one description and one guess, and the guess would surface as an auction priced
 * off the wrong column.
 *
 * The zod locale is deliberately **not** configured here. The pipeline sets it to
 * Italian because its messages go straight to whoever runs it; in the app a zod
 * message never reaches the screen — the IPC layer turns it into a code from
 * shared/errors.ts long before. Setting a global from a shared module would
 * quietly decide that for both.
 */

/**
 * The listone stores numbers as numbers. A future one might switch to text with a
 * decimal comma, and that should cost a conversion, not a rejected file.
 */
const toNumber = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const text = value.trim().replace(',', '.')
  return text === '' ? undefined : Number(text)
}

const decimal = z.preprocess(toNumber, z.number().finite())
const whole = z.preprocess(toNumber, z.number().int())
const filled = z.string().trim().min(1)

/**
 * Exported so the statistiche schema, which only the pipeline needs, coerces
 * cells by the same rules. Duplicating them is how one file starts accepting a
 * decimal comma and the other stops.
 */
export const cell = { decimal, whole, filled }

/**
 * 'Dd;Dc' → ['Dd', 'Dc']. Up to three, and every one has to be a known role.
 *
 * Deduplicated, because `player_mantra_role` is PRIMARY KEY (player_id,
 * role_code) and a cell reading `Dd;Dd` would otherwise reach SQLite as a
 * constraint violation — thrown from inside the import transaction and arriving
 * at the renderer as UNKNOWN, after a preview that had declared the file fine.
 *
 * Deduplicated rather than refused on purpose. `Dd;Dd` carries no information
 * that `Dd` does not, so dropping the row would cost a player his import and,
 * next time round, mark him delisted — a heavy answer to a typo.
 */
const mantraRoles = z
  .string()
  .transform((value) => [
    ...new Set(
      value
        .split(';')
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(z.enum(MANTRA_ROLES)).min(1).max(3))

/** Keys are `headerKey(header)`: lower case, spacing collapsed, dots kept. */
export const quotazione = z
  .object({
    id: whole,
    r: z.enum(CLASSIC_ROLES),
    rm: mantraRoles,
    nome: filled,
    squadra: filled,
    'qt.a': decimal,
    'qt.i': decimal,
    'qt.a m': decimal,
    'qt.i m': decimal,
    fvm: decimal,
    'fvm m': decimal,
  })
  .transform((row) => ({
    sourceId: row.id,
    name: row.nome,
    team: row.squadra,
    roleClassic: row.r,
    rolesMantra: row.rm,
    qtClassicCurrent: row['qt.a'],
    qtClassicInitial: row['qt.i'],
    qtMantraCurrent: row['qt.a m'],
    qtMantraInitial: row['qt.i m'],
    fvmClassic: row.fvm,
    fvmMantra: row['fvm m'],
  }))

export type Quotazione = z.infer<typeof quotazione>

export const QUOTAZIONI_COLUMNS = [
  'Id',
  'R',
  'RM',
  'Nome',
  'Squadra',
  'Qt.A',
  'Qt.I',
  'Qt.A M',
  'Qt.I M',
  'FVM',
  'FVM M',
]

/** The columns that identify the header row, per document 4 §6. */
export const LISTONE_MARKERS = ['Id', 'Nome', 'Squadra']

/**
 * How many bad rows a file may carry before it is refused whole.
 *
 * Document 4 §6 says "una manciata" and means it: one or two odd rows are a
 * quirk — a note in a cell, a spare total — while six is a file whose shape has
 * changed, and reading it row by row would produce plausible nonsense.
 */
export const MAX_REJECTED_ROWS = 5

export type RowOutcome<T> = {
  rows: T[]
  /** Columns the caller asked for that the sheet does not carry. */
  missing: string[]
  /** One line per rejected row, numbered as the file numbers it. */
  rejected: string[]
  /** sourceIds appearing more than once — would break UNIQUE (season_id, source_id). */
  duplicates: number[]
}

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(riga)'} ${issue.message}`)
    .join('; ')
}

/**
 * Validates every row and reports, without deciding what a failure means.
 *
 * Returns instead of throwing because the two callers answer differently: the
 * pipeline prints the rejected rows and exits non-zero, while the app shows them
 * in the preview of document 2 §4.1 *before* anything is written. Neither policy
 * belongs to the parsing.
 *
 * With a column missing nothing is parsed: every row would fail for the same
 * reason and the list would say the same thing five hundred times.
 */
export function collectRows<T extends { sourceId: number }>(
  sheet: Sheet,
  schema: z.ZodType<T>,
  columns: readonly string[],
): RowOutcome<T> {
  const missing = missingColumns(sheet, columns)
  if (missing.length > 0) return { rows: [], missing, rejected: [], duplicates: [] }

  const rows: T[] = []
  const rejected: string[] = []
  sheet.rows.forEach((row, index) => {
    const parsed = schema.safeParse(row)
    if (parsed.success) rows.push(parsed.data)
    else rejected.push(`riga ${sheet.headerRow + 1 + index}: ${describe(parsed.error)}`)
  })

  // Caught here rather than at insert time, several stages later and with nothing
  // left to say which file caused it.
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const row of rows) {
    if (seen.has(row.sourceId)) duplicates.add(row.sourceId)
    else seen.add(row.sourceId)
  }

  return { rows, missing, rejected, duplicates: [...duplicates] }
}

/**
 * The season a listone file name suggests, or null.
 *
 * Only a suggestion, and document 4 §6 is explicit about why: "il file non lo
 * dice in modo affidabile", so the import proposes and always asks. A wrong guess
 * that the user confirms is a listone filed under the wrong season, with the
 * purchases of a whole auction hanging off it.
 *
 *   Quotazioni_Fantacalcio_Stagione_2026_27.xlsx → 2026-27
 */
export function seasonFromFilename(name: string): string | null {
  // The four digits must not themselves be part of a longer run, or a file named
  // after an export timestamp would read as a season.
  const match = /(?<!\d)(\d{4})[_\-. ](\d{2})(?!\d)/.exec(name)
  if (!match) return null

  const [, start, end] = match
  // 2026-27 is the year after 2026. A pair that does not follow is not a season,
  // it is two numbers that happen to sit next to each other.
  if ((Number(start) + 1) % 100 !== Number(end)) return null
  return `${start}-${end}`
}

/**
 * `2026-27` → `Serie A 2026/27`, the label `season.label` carries.
 *
 * Derived rather than typed in, because the season the user confirms is the only
 * input the import has: two spellings of one season would show up as two rows in
 * the seasons list with nothing to say they are the same year.
 */
export function seasonLabel(seasonId: string): string {
  return `Serie A ${seasonId.replace('-', '/')}`
}
