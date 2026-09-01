import { describe, expect, it } from 'vitest'
import { collectRows, quotazione, QUOTAZIONI_COLUMNS, seasonFromFilename } from './listone'
import type { Sheet } from './sheet'

/**
 * The season guess, and the one thing `collectRows` decides on its own.
 *
 * `seasonFromFilename` only ever proposes — document 4 §6 says the file "non lo
 * dice in modo affidabile", so the import always asks for confirmation. That is
 * exactly why a wrong guess is dangerous rather than harmless: it arrives
 * pre-filled in a dialog, and a confirmed wrong season files a whole listone
 * under a year that is not its own, with an auction's purchases hanging off it.
 */
describe('seasonFromFilename', () => {
  it.each([
    ['Quotazioni_Fantacalcio_Stagione_2026_27.xlsx', '2026-27'],
    ['Statistiche_Fantacalcio_Stagione_2023_24.xlsx', '2023-24'],
    ['listone 2025 26.xlsx', '2025-26'],
    ['listone-2024-25.xlsx', '2024-25'],
    // The century rolls over and the arithmetic has to roll with it.
    ['listone_1999_00.xlsx', '1999-00'],
  ])('reads %s as %s', (name, expected) => {
    expect(seasonFromFilename(name)).toBe(expected)
  })

  it.each([
    ['nothing that looks like a year', 'listone.xlsx'],
    // Two numbers next to each other are not a season.
    ['a pair that does not follow on', 'export_2026_31.xlsx'],
    // A timestamp is the likeliest false positive: it is all digits and it has
    // a four-digit year in front.
    ['an export timestamp', 'listone_20260901_12.xlsx'],
    ['a four-digit year alone', 'listone_2026.xlsx'],
  ])('refuses to guess from %s', (_label, name) => {
    expect(seasonFromFilename(name)).toBeNull()
  })
})

const sheet = (headers: string[], rows: Array<Record<string, unknown>>): Sheet => ({
  headers,
  headerRow: 3,
  rows: rows as Sheet['rows'],
})

const row = (id: number): Record<string, unknown> => ({
  id,
  r: 'A',
  rm: 'Pc',
  nome: `Tizio ${id}`,
  squadra: 'Inter',
  'qt.a': 20,
  'qt.i': 19,
  'qt.a m': 21,
  'qt.i m': 20,
  fvm: 80,
  'fvm m': 82,
})

describe('collectRows', () => {
  /**
   * With a column missing every row fails for the same reason. Parsing them
   * anyway would produce five hundred identical complaints and bury the one line
   * that says what is actually wrong with the file.
   */
  it('names the missing column and does not parse a single row', () => {
    const outcome = collectRows(
      sheet(QUOTAZIONI_COLUMNS.filter((c) => c !== 'FVM M'), [row(1)]),
      quotazione,
      QUOTAZIONI_COLUMNS,
    )
    expect(outcome.missing).toEqual(['FVM M'])
    expect(outcome.rejected).toEqual([])
    expect(outcome.rows).toEqual([])
  })

  it('numbers a rejected row the way the file numbers it', () => {
    const outcome = collectRows(
      sheet(QUOTAZIONI_COLUMNS, [row(1), { ...row(2), 'qt.a': 'non un numero' }]),
      quotazione,
      QUOTAZIONI_COLUMNS,
    )
    expect(outcome.rows).toHaveLength(1)
    // headerRow 3, so the second data row is line 5 of the file — not "row 2".
    expect(outcome.rejected[0]).toMatch(/^riga 5:/)
  })

  it('reports a repeated Id, which would break UNIQUE (season_id, source_id)', () => {
    const outcome = collectRows(
      sheet(QUOTAZIONI_COLUMNS, [row(7), row(7), row(9)]),
      quotazione,
      QUOTAZIONI_COLUMNS,
    )
    expect(outcome.duplicates).toEqual([7])
  })
})

/**
 * `player_mantra_role` is PRIMARY KEY (player_id, role_code), and a listone cell
 * reading `Dd;Dd` is the one shape that reaches SQLite as a violation thrown from
 * inside the import transaction — arriving at the renderer as UNKNOWN, after a
 * preview that had already called the file importable.
 */
describe('rolesMantra', () => {
  const parse = (rm: string): string[] => quotazione.parse({ ...row(1), rm }).rolesMantra

  it('drops a repeated role instead of carrying it to the database', () => {
    expect(parse('Dd;Dd')).toEqual(['Dd'])
    expect(parse('Dd;Dc;Dd')).toEqual(['Dd', 'Dc'])
  })

  it('keeps distinct roles, and their order', () => {
    expect(parse('Dd;Dc;B')).toEqual(['Dd', 'Dc', 'B'])
  })

  /** Deduplication must not become a way to smuggle in a fourth role. */
  it('still refuses more than three distinct roles', () => {
    expect(() => parse('Dd;Dc;B;E')).toThrow()
  })

  it('still refuses a role that is not a role', () => {
    expect(() => parse('Dd;Zz')).toThrow()
  })
})
