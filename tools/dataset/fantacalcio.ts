import { z } from 'zod'
import { CLASSIC_ROLES, MANTRA_ROLES } from '@shared/domain'
import { headerKey, readSheet, type Sheet } from './xlsx'

/**
 * Stage 1 of document 4: the two Fantacalcio.it files.
 *
 * Robustness comes from §6, and every rule there answers a way this file has
 * moved between seasons: the header row is found rather than assumed, columns are
 * read by name rather than by position, every row is validated, and if more than
 * a handful fail the whole file is refused. A silent partial import is worse than
 * a failed one — it produces an auction with a hole in it and no error anywhere.
 */

/**
 * How many bad rows a file may carry before it is refused whole.
 *
 * Document 4 §6 says "una manciata" and means it: one or two odd rows are a
 * quirk — a note in a cell, a spare total — while six is a file whose shape has
 * changed, and reading it row by row would produce plausible nonsense. Tolerated
 * rows are not swallowed: they are listed on stderr with their line number.
 */
const MAX_REJECTED_ROWS = 5

/**
 * zod speaks English by default, and the rows it refuses end up in front of the
 * person running the pipeline. Set here rather than in shared/ because the blast
 * radius stays the pipeline: the app never surfaces a zod message directly — the
 * IPC layer turns it into a code from shared/errors.ts long before anyone reads
 * it.
 */
z.config(z.locales.it())

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

/** 'Dd;Dc' → ['Dd', 'Dc']. Up to three, and every one has to be a known role. */
const mantraRoles = z
  .string()
  .transform((value) => value.split(';').map((role) => role.trim()).filter(Boolean))
  .pipe(z.array(z.enum(MANTRA_ROLES)).min(1).max(3))

/** Keys are `headerKey(header)`: lower case, spacing collapsed, dots kept. */
const quotazione = z
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

const statistica = z
  .object({
    id: whole,
    r: z.enum(CLASSIC_ROLES),
    nome: filled,
    squadra: filled,
    pv: whole,
    mv: decimal,
    fm: decimal,
    gf: whole,
    gs: whole,
    rp: whole,
    rc: whole,
    'r+': whole,
    'r-': whole,
    ass: whole,
    amm: whole,
    esp: whole,
    au: whole,
  })
  .transform((row) => ({
    sourceId: row.id,
    name: row.nome,
    team: row.squadra,
    roleClassic: row.r,
    matchesRated: row.pv, // 'Pv': matches WITH A VOTE, not appearances
    /**
     * A player with no rated match has `Mv 0` and `Fm 0` in the file, and zero is
     * not an average — it is how the file spells "no data". Kept as 0 it would
     * rank him below everyone who actually played badly, which is the opposite of
     * what it means. Document 4 §4 wants the dataset faithful, and null is the
     * faithful reading of that cell.
     */
    avgVote: row.pv === 0 ? null : row.mv,
    fantaAvg: row.pv === 0 ? null : row.fm,
    goals: row.gf,
    goalsConceded: row.gs,
    penaltiesSaved: row.rp, // 'Rp' parati
    penaltiesTaken: row.rc, // 'Rc' calciati
    penaltiesScored: row['r+'],
    penaltiesMissed: row['r-'],
    assists: row.ass,
    yellowCards: row.amm,
    redCards: row.esp,
    ownGoals: row.au,
  }))

export type Quotazione = z.infer<typeof quotazione>
export type Statistica = z.infer<typeof statistica>

const QUOTAZIONI_COLUMNS = ['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'Qt.I', 'Qt.A M', 'Qt.I M', 'FVM', 'FVM M']
/** The columns that identify the header row, per document 4 §6. */
const MARKERS = ['Id', 'Nome', 'Squadra']

const STATISTICHE_COLUMNS = ['Id', 'R', 'Nome', 'Squadra', 'Pv', 'Mv', 'Fm', 'Gf', 'Gs', 'Rp', 'Rc', 'R+', 'R-', 'Ass', 'Amm', 'Esp', 'Au']

/** Document 4 §6: a refused file has to say which columns it did not recognise. */
function requireColumns(sheet: Sheet, wanted: string[], file: string): void {
  const present = new Set(sheet.headers.map(headerKey))
  const missing = wanted.filter((column) => !present.has(headerKey(column)))
  if (missing.length === 0) return
  throw new Error(
    `${file}: colonne non riconosciute: ${missing.join(', ')}.\n` +
      `  intestazione trovata alla riga ${sheet.headerRow}: ${sheet.headers.join(' | ')}`,
  )
}

function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(riga)'} ${issue.message}`).join('; ')
}

/**
 * The validation half, kept free of the disk on purpose.
 *
 * `readSheet` does the I/O and hands over a plain object; everything that can be
 * wrong with a listone is decided here, on data a test can write by hand. The
 * seam is not decoration: the three refusals below are the kind that fail
 * silently when they break — a guard that never fires looks exactly like a file
 * that is always clean.
 */
export function parseSheet<T extends { sourceId: number }>(
  sheet: Sheet,
  schema: z.ZodType<T>,
  columns: string[],
  label: string,
): T[] {
  requireColumns(sheet, columns, label)

  const rows: T[] = []
  const rejected: string[] = []
  sheet.rows.forEach((row, index) => {
    const parsed = schema.safeParse(row)
    if (parsed.success) rows.push(parsed.data)
    else rejected.push(`  riga ${sheet.headerRow + 1 + index}: ${describe(parsed.error)}`)
  })

  if (rejected.length > MAX_REJECTED_ROWS) {
    throw new Error(
      `${label}: ${rejected.length} righe su ${sheet.rows.length} non superano la validazione, ` +
        `più della manciata tollerata (${MAX_REJECTED_ROWS}). Il file è rifiutato per intero: ` +
        `un import parziale silenzioso è peggio di un import fallito.\n` +
        rejected.slice(0, 10).join('\n') +
        (rejected.length > 10 ? `\n  … e altre ${rejected.length - 10}` : ''),
    )
  }
  if (rejected.length > 0) {
    console.warn(`${label}: ${rejected.length} righe scartate, sotto la soglia di rifiuto:`)
    console.warn(rejected.join('\n'))
  }

  // Would otherwise break UNIQUE (season_id, source_id) at import time, several
  // stages later and with nothing left to say which file caused it.
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const row of rows) {
    if (seen.has(row.sourceId)) duplicates.add(row.sourceId)
    else seen.add(row.sourceId)
  }
  if (duplicates.size > 0) {
    throw new Error(`${label}: Id ripetuti nello stesso file: ${[...duplicates].join(', ')}`)
  }

  return rows
}

/** The current season's listone: roles, teams, quotazioni. */
export async function readQuotazioni(file: string): Promise<Quotazione[]> {
  return parseSheet(await readSheet(file, MARKERS), quotazione, QUOTAZIONI_COLUMNS, file)
}

/** One season of statistics, past or in progress. */
export async function readStatistiche(file: string): Promise<Statistica[]> {
  return parseSheet(await readSheet(file, MARKERS), statistica, STATISTICHE_COLUMNS, file)
}

/** Exported for the test, which builds its sheets by hand. */
export const schemas = { quotazione, statistica }
export const columns = { quotazioni: QUOTAZIONI_COLUMNS, statistiche: STATISTICHE_COLUMNS }
