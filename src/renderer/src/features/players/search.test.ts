import { describe, expect, it } from 'vitest'
import type { PlayerRow } from '@shared/types'
import { haystack, search, searchKey } from './search'

/**
 * The search of T14b, whose criterion is one line: typing the name a player is
 * called by at the table has to find him.
 *
 * **Where the fixtures come from.** The listone side is real, read out of
 * `tools/dataset/output/2026-27/v1.json.gz`: those are the actual entries, with
 * their actual source ids. The CLAUDE.md is explicit about why that matters —
 * a fixture chosen from memory tests a listone that does not exist, and `lauta`
 * against an invented `Lautaro Martinez` would have passed on the day the app
 * shipped a search that finds nothing.
 *
 * The full names are the other half, and they are **hand-written**: at the time
 * this was written the FBref exports had not been downloaded, so nothing offline
 * carried them. They are what an export is expected to say, and the shape of the
 * matching is proven separately by running the pipeline. When the real CSVs
 * arrive these should be re-read out of the built dataset like the rest.
 */

const row = (id: number, name: string, fullName: string | null, team: string): PlayerRow => ({
  id,
  name,
  fullName,
  roleClassic: 'A',
  rolesMantra: [],
  teamName: team,
  teamCode: team.slice(0, 3).toUpperCase(),
  qtClassicCurrent: 30,
  qtClassicInitial: 30,
  fvmClassic: 200,
  penaltyTaker: false,
  delisted: false,
  stats: {},
})

// The eight the listone really spells this way, plus one that needs no second
// name at all — `Zortea` is written the same by both sources.
const LISTONE: PlayerRow[] = [
  row(2764, 'Martinez L.', 'Lautaro Martínez', 'Inter'),
  row(5116, 'Martinez Jo.', 'Josep Martínez', 'Inter'),
  row(4871, 'Thuram', 'Marcus Thuram', 'Inter'),
  row(5562, 'Thuram K.', 'Khéphren Thuram', 'Juventus'),
  row(530, 'Pellegrini Lo.', 'Lorenzo Pellegrini', 'Roma'),
  row(2728, 'Pellegrini Lu.', 'Luca Pellegrini', 'Lazio'),
  row(4179, 'Gonzalez N.', 'Nicolás González', 'Juventus'),
  row(7071, 'Esposito F.P.', 'Francesco Pio Esposito', 'Inter'),
  // Nobody FBref reached: the state every row is in before the stage runs.
  row(4433, 'Zortea', null, 'Bologna'),
  // The other reason a row can carry no second name: both sources spell it the
  // same. That is the mononym and not the one-word surname — FBref would write
  // `Nadir Zortea` for the row above — so the fixture is a real mononym.
  row(2788, 'Bremer', 'Bremer', 'Juventus'),
]

const found = (query: string): string[] =>
  search(haystack(LISTONE), query).map((p) => p.name)

describe('searchKey', () => {
  /**
   * The exact string, written out, and not a comparison between two calls.
   *
   * T17 learned this one the expensive way: its canonical-form tests compared
   * `canonicalize(x)` with `canonicalize(y)`, which any ordering satisfies as
   * long as it is always the same one, and the mutation that reversed the sort
   * survived every test. An equality proves a function is deterministic, never
   * *which* form it produces — and here the form is the contract, because it is
   * what uFuzzy is handed.
   */
  it('writes both spellings of both names, spaced and closed up', () => {
    expect(searchKey('Martinez L.', 'Lautaro Martínez')).toBe(
      'martinez l martinezl lautaro martinez lautaromartinez',
    )
  })

  it('leaves a player without a full name exactly as he was before T14b', () => {
    expect(searchKey('Zortea', null)).toBe('zortea')
    expect(searchKey('Martinez L.', null)).toBe('martinez l martinezl')
  })

  /**
   * The mononym. Not the one-word surname, which is the tempting guess and the
   * wrong one: FBref writes a given name in front of every surname, so the 407
   * single-word names of this listone all gain a second spelling.
   */
  it('does not repeat a spelling the two sources agree on', () => {
    expect(searchKey('Bremer', 'Bremer')).toBe('bremer')
    // Same name, different accents: normalisation collapses them to one.
    expect(searchKey('Vlahovic', 'Vlahović')).toBe('vlahovic')
  })

  it('drops a full name that normalises to nothing rather than doubling a space', () => {
    expect(searchKey('Bremer', '—')).toBe('bremer')
  })
})

describe('search', () => {
  /**
   * The criterion of T14b, verbatim from the roadmap: "digitare il nome con cui
   * il giocatore viene chiamato al tavolo lo trova".
   */
  it('finds Martinez L. by typing lauta', () => {
    expect(found('lauta')).toEqual(['Martinez L.'])
  })

  it('finds him with the spaces closed up too', () => {
    expect(found('lautaromartinez')).toEqual(['Martinez L.'])
  })

  /**
   * The regression that would be invisible: the surname is what the listone
   * prints and what half the room reads off a printout, and it has to keep
   * working. Both Martinez, both Thuram, both Pellegrini.
   */
  it('still finds every namesake by the surname alone', () => {
    expect(found('martinez').sort()).toEqual(['Martinez Jo.', 'Martinez L.'])
    expect(found('thuram').sort()).toEqual(['Thuram', 'Thuram K.'])
    expect(found('pellegrini').sort()).toEqual(['Pellegrini Lo.', 'Pellegrini Lu.'])
  })

  /** And the first name separates them, which is the point of carrying it. */
  it('separates namesakes by the name they are called by', () => {
    expect(found('josep')).toEqual(['Martinez Jo.'])
    expect(found('khephren')).toEqual(['Thuram K.'])
    expect(found('lorenzo')).toEqual(['Pellegrini Lo.'])
    expect(found('luca')).toEqual(['Pellegrini Lu.'])
  })

  /**
   * Document 4 §5: normalisation "serve anche alla ricerca nell'app, dove si
   * digita senza accenti". `González` is typed `gonzalez` on any keyboard in the
   * room, and `Khéphren` is typed `khephren`.
   */
  it('finds an accented full name typed without accents', () => {
    expect(found('nicolas')).toEqual(['Gonzalez N.'])
  })

  /** A player the optional stage never reached is still findable, as before. */
  it('finds a player who has no full name at all', () => {
    expect(found('zortea')).toEqual(['Zortea'])
  })

  /** And so is a mononym, whose one spelling appears in the needle once. */
  it('finds a mononym', () => {
    expect(found('bremer')).toEqual(['Bremer'])
  })

  /** An empty box is the whole list, unchanged by any of this. */
  it('returns everyone for an empty query', () => {
    expect(search(haystack(LISTONE), '').length).toBe(LISTONE.length)
  })
})
