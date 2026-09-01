import { z } from 'zod'
import { CLASSIC_ROLES } from '@shared/domain'
import {
  cell,
  collectRows,
  LISTONE_MARKERS,
  MAX_REJECTED_ROWS,
  QUOTAZIONI_COLUMNS,
  quotazione,
  type Quotazione,
} from '@shared/listone'
import { readSheet, type Sheet } from './xlsx'

/**
 * Stage 1 of document 4: the two Fantacalcio.it files.
 *
 * The quotazioni half moved to `@shared/listone` when T8 taught the app to read
 * the same file: robustness rules that two programs apply to one file have to be
 * one implementation, or the pipeline and the app end up disagreeing about what a
 * listone says. What stays here is the statistiche schema, which only this side
 * reads, and the pipeline's policy on a bad row — print it and stop.
 */

/**
 * zod speaks English by default, and the rows it refuses end up in front of the
 * person running the pipeline. Set here rather than in shared/ because the blast
 * radius stays the pipeline: the app never surfaces a zod message directly — the
 * IPC layer turns it into a code from shared/errors.ts long before anyone reads
 * it, and a shared module setting a global would decide this for both.
 */
z.config(z.locales.it())

const { decimal, whole, filled } = cell

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

export type { Quotazione }
export type Statistica = z.infer<typeof statistica>

const STATISTICHE_COLUMNS = ['Id', 'R', 'Nome', 'Squadra', 'Pv', 'Mv', 'Fm', 'Gf', 'Gs', 'Rp', 'Rc', 'R+', 'R-', 'Ass', 'Amm', 'Esp', 'Au']

/**
 * The pipeline's policy on what `collectRows` reports.
 *
 * The validation itself is shared with the app; what differs is the answer. Here
 * a refusal is fatal and printed, because the person who ran the pipeline is
 * looking at the terminal. In the app the same outcome fills the preview of
 * document 2 §4.1, before anything is written.
 */
export function parseSheet<T extends { sourceId: number }>(
  sheet: Sheet,
  schema: z.ZodType<T>,
  columns: readonly string[],
  label: string,
): T[] {
  const outcome = collectRows(sheet, schema, columns)

  if (outcome.missing.length > 0) {
    throw new Error(
      `${label}: colonne non riconosciute: ${outcome.missing.join(', ')}.\n` +
        `  intestazione trovata alla riga ${sheet.headerRow}: ${sheet.headers.join(' | ')}`,
    )
  }

  if (outcome.rejected.length > MAX_REJECTED_ROWS) {
    throw new Error(
      `${label}: ${outcome.rejected.length} righe su ${sheet.rows.length} non superano la ` +
        `validazione, più della manciata tollerata (${MAX_REJECTED_ROWS}). Il file è rifiutato ` +
        `per intero: un import parziale silenzioso è peggio di un import fallito.\n  ` +
        outcome.rejected.slice(0, 10).join('\n  ') +
        (outcome.rejected.length > 10 ? `\n  … e altre ${outcome.rejected.length - 10}` : ''),
    )
  }
  if (outcome.rejected.length > 0) {
    console.warn(`${label}: ${outcome.rejected.length} righe scartate, sotto la soglia di rifiuto:`)
    console.warn(outcome.rejected.map((line) => `  ${line}`).join('\n'))
  }

  if (outcome.duplicates.length > 0) {
    throw new Error(`${label}: Id ripetuti nello stesso file: ${outcome.duplicates.join(', ')}`)
  }

  return outcome.rows
}

/** The current season's listone: roles, teams, quotazioni. */
export async function readQuotazioni(file: string): Promise<Quotazione[]> {
  return parseSheet(await readSheet(file, LISTONE_MARKERS), quotazione, QUOTAZIONI_COLUMNS, file)
}

/** One season of statistics, past or in progress. */
export async function readStatistiche(file: string): Promise<Statistica[]> {
  return parseSheet(await readSheet(file, LISTONE_MARKERS), statistica, STATISTICHE_COLUMNS, file)
}

/** Exported for the test, which builds its sheets by hand. */
export const schemas = { quotazione, statistica }
export const columns = { quotazioni: QUOTAZIONI_COLUMNS, statistiche: STATISTICHE_COLUMNS }
