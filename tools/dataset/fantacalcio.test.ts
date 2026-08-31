import { describe, expect, it, vi } from 'vitest'
import { columns, parseSheet, schemas } from './fantacalcio'
import type { Sheet } from './xlsx'

/**
 * The three refusals of document 4 §6, and the one translation that changes what
 * a number means.
 *
 * These are here and not in the "poco e mirato" list of CLAUDE.md for a specific
 * reason: every one of them fails silently when it breaks. A refusal that never
 * fires is indistinguishable from a file that is always clean, and the duplicate
 * check in this very module shipped broken once — `Set.add()` returns the set,
 * not a boolean, so the condition was permanently false and nothing failed.
 *
 * They touch neither the disk nor exceljs: `parseSheet` takes the plain object
 * `readSheet` produces, so the sheets below are written by hand.
 */

const QUOTAZIONI_HEADERS = ['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'Qt.I', 'Qt.A M', 'Qt.I M', 'FVM', 'FVM M']

function quotazioneRow(id: number, role = 'A'): Record<string, string | number> {
  return {
    id, r: role, rm: 'Pc', nome: `Tizio ${id}`, squadra: 'Inter',
    'qt.a': 20, 'qt.i': 19, 'qt.a m': 21, 'qt.i m': 20, fvm: 80, 'fvm m': 82,
  }
}

function sheet(rows: Array<Record<string, unknown>>, headers = QUOTAZIONI_HEADERS): Sheet {
  return { headers, headerRow: 2, rows } as Sheet
}

const parseQuotazioni = (s: Sheet): unknown[] =>
  parseSheet(s, schemas.quotazione, columns.quotazioni, 'listone.xlsx')

describe('parsing del listone', () => {
  it('legge una riga buona', () => {
    const [player] = parseQuotazioni(sheet([quotazioneRow(2170)])) as Array<{ sourceId: number }>
    expect(player).toMatchObject({ sourceId: 2170, roleClassic: 'A', rolesMantra: ['Pc'] })
  })

  it('spacchetta i ruoli Mantra multipli', () => {
    const rows = [{ ...quotazioneRow(1), rm: 'Dd;Dc' }]
    const [player] = parseQuotazioni(sheet(rows)) as Array<{ rolesMantra: string[] }>
    expect(player.rolesMantra).toEqual(['Dd', 'Dc'])
  })

  it('rifiuta il file se manca una colonna, e la nomina', () => {
    const senzaFvm = QUOTAZIONI_HEADERS.filter((h) => h !== 'FVM M')
    expect(() => parseQuotazioni(sheet([quotazioneRow(1)], senzaFvm))).toThrow(/FVM M/)
  })

  it('rifiuta il file intero oltre la manciata di righe non valide', () => {
    const rows = [quotazioneRow(1), ...Array.from({ length: 6 }, (_, i) => quotazioneRow(100 + i, 'X'))]
    expect(() => parseQuotazioni(sheet(rows))).toThrow(/rifiutato per intero/)
  })

  it('tollera due righe non valide e tiene le buone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rows = [quotazioneRow(1), quotazioneRow(2), quotazioneRow(3, 'X'), quotazioneRow(4, 'X')]
    expect(parseQuotazioni(sheet(rows))).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('rifiuta un Id ripetuto nello stesso file', () => {
    const rows = [quotazioneRow(7), { ...quotazioneRow(7), nome: 'Caio' }]
    expect(() => parseQuotazioni(sheet(rows))).toThrow(/Id ripetuti/)
  })
})

const STATISTICHE_HEADERS = ['Id', 'R', 'Nome', 'Squadra', 'Pv', 'Mv', 'Fm', 'Gf', 'Gs', 'Rp', 'Rc', 'R+', 'R-', 'Ass', 'Amm', 'Esp', 'Au']

function statisticaRow(pv: number, mv: number, fm: number): Record<string, string | number> {
  return {
    id: 1, r: 'A', nome: 'Tizio', squadra: 'Inter',
    pv, mv, fm, gf: 0, gs: 0, rp: 0, rc: 0, 'r+': 0, 'r-': 0, ass: 0, amm: 0, esp: 0, au: 0,
  }
}

describe('lo zero delle medie', () => {
  const parse = (rows: Array<Record<string, unknown>>): Array<{ avgVote: number | null; fantaAvg: number | null }> =>
    parseSheet(sheet(rows, STATISTICHE_HEADERS), schemas.statistica, columns.statistiche, 'stat.xlsx') as never

  /**
   * The file spells "no data" as 0. Kept as 0 it would sort a player who never
   * played below everyone who played badly — the opposite of what the cell means,
   * and wrong in a way no one would notice while reading a table.
   */
  it('senza partite a voto, la media non è zero: non c\'è', () => {
    expect(parse([statisticaRow(0, 0, 0)])[0]).toMatchObject({ avgVote: null, fantaAvg: null })
  })

  it('con almeno una partita a voto, la media si tiene com\'è', () => {
    expect(parse([statisticaRow(1, 6, 5.5)])[0]).toMatchObject({ avgVote: 6, fantaAvg: 5.5 })
  })
})
