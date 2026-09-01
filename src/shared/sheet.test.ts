import { describe, expect, it } from 'vitest'
import { findSheet, flattenCell, type CellValue } from './sheet'

/**
 * The robustness document 4 §6 asks for by name, under test for the first time.
 *
 * Until T8 this logic sat next to `exceljs`, so Vitest could not reach it: the
 * pipeline's own tests say as much in a comment and hand `parseSheet` sheets
 * written by hand. Which meant the two rules the document states outright — find
 * the header row instead of assuming it, map columns by name instead of by
 * position — were the only part of the parser nothing exercised.
 *
 * They are also the two whose failure is silent. A parser that trusts position
 * does not break when a column is inserted; it reads the neighbouring one, and
 * every quotazione is off by one for a whole auction.
 */

const grid = (...rows: CellValue[][]): CellValue[][] => rows

describe('findSheet', () => {
  it('finds the header row when it is not the first', () => {
    const found = findSheet(
      grid(
        ['Listone Fantacalcio 2026/27', null, null],
        [null, null, null],
        ['Id', 'Nome', 'Squadra'],
        [1, 'Sommer', 'Inter'],
      ),
      ['Id', 'Nome', 'Squadra'],
    )

    expect(found.found).toBe(true)
    if (!found.found) return
    expect(found.sheet.headerRow).toBe(3)
    expect(found.sheet.rows).toEqual([{ id: 1, nome: 'Sommer', squadra: 'Inter' }])
  })

  it('matches the markers regardless of case and spacing', () => {
    const found = findSheet(grid(['  ID ', 'nome', 'SQUADRA'], [1, 'Sommer', 'Inter']), [
      'Id',
      'Nome',
      'Squadra',
    ])
    expect(found.found).toBe(true)
  })

  /**
   * The refusal that keeps "map by name" honest. Two columns called `Qt.A` and
   * the mapping is a coin toss, so the file is refused rather than read.
   */
  it('refuses a repeated column name instead of picking one', () => {
    const found = findSheet(grid(['Id', 'Nome', 'Squadra', 'Qt.A', 'Qt.A'], [1, 'a', 'b', 2, 3]), [
      'Id',
      'Nome',
      'Squadra',
    ])
    expect(found).toMatchObject({ found: false, reason: 'duplicate-column', column: 'qt.a' })
  })

  it('says what it read when no row carries the markers', () => {
    const found = findSheet(grid(['Giocatore', 'Club'], ['Sommer', 'Inter']), ['Id', 'Nome'])
    expect(found).toMatchObject({ found: false, reason: 'no-header' })
    // Both narrowings: the failure branch is a union of two shapes and only one
    // of them carries `seen`.
    if (found.found || found.reason !== 'no-header') return
    // Not just "not found": the rows it looked at, so a changed file is legible.
    expect(found.seen[0]).toBe('Giocatore | Club')
  })

  it('stops looking after the search depth instead of scanning a whole file', () => {
    const rows: CellValue[][] = Array.from({ length: 30 }, () => [null, null])
    rows[25] = ['Id', 'Nome']
    expect(findSheet(rows, ['Id', 'Nome'], 20).found).toBe(false)
    expect(findSheet(rows, ['Id', 'Nome'], 30).found).toBe(true)
  })

  /** Trailing empties are formatting, not columns: they must not become keys. */
  it('cuts the header at the last named column', () => {
    const found = findSheet(grid(['Id', 'Nome', '', ''], [1, 'Sommer', 'x', 'y']), ['Id', 'Nome'])
    expect(found.found).toBe(true)
    if (!found.found) return
    expect(found.sheet.headers).toEqual(['Id', 'Nome'])
    expect(found.sheet.rows).toEqual([{ id: 1, nome: 'Sommer' }])
  })

  it('skips rows that are entirely empty', () => {
    const found = findSheet(
      grid(['Id', 'Nome'], [1, 'Sommer'], [null, null], ['', ''], [2, 'Bastoni']),
      ['Id', 'Nome'],
    )
    expect(found.found).toBe(true)
    if (!found.found) return
    expect(found.sheet.rows).toHaveLength(2)
  })
})

/**
 * A cell is not always a value. The listone carries formulas, rich text and the
 * occasional hyperlink, and reading one of those as text puts `[object Object]`
 * — or worse, a spreadsheet's own `#REF!` — into a player's name.
 */
describe('flattenCell', () => {
  it.each([
    ['plain text', 'Sommer', 'Sommer'],
    ['a number', 21, 21],
    ['nothing', null, null],
    ['a formula, by its result', { formula: 'A1&B1', result: 'Sommer' }, 'Sommer'],
    ['rich text, joined', { richText: [{ text: 'Mar' }, { text: 'tinez' }] }, 'Martinez'],
    ['a hyperlink, by its text', { text: 'Inter', hyperlink: 'http://x' }, 'Inter'],
    ['an error cell, as nothing', { error: '#REF!' }, null],
  ])('reads %s', (_label, input, expected) => {
    expect(flattenCell(input)).toBe(expected)
  })

  it('reads a formula whose result is itself rich text', () => {
    expect(flattenCell({ formula: 'X', result: { richText: [{ text: 'ok' }] } })).toBe('ok')
  })

  it('keeps a date as a date, since a listone can carry one', () => {
    const date = new Date('1988-12-17T00:00:00Z')
    expect(flattenCell(date)).toBe(date)
  })
})
