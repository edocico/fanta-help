import { describe, expect, it } from 'vitest'
import {
  backupsToPrune,
  bonusIndex,
  cleanSheetRate,
  concededPerMatch,
  convenience,
  malusRate,
  MATCHDAYS,
  minutesPerMatch,
  normalizeName,
  reliability,
  startShare,
} from './domain'

/**
 * The four cases document 6 §7 assigns to T5, one per step of the pipeline
 * described in document 4 §5.
 *
 * They look trivial and they are not. `normalizeName` has two callers that never
 * meet: the offline pipeline writes `player.name_normalized` with it, and the app
 * searches that column with it. Nothing connects the two at compile time. If the
 * function ever changes shape — a stricter punctuation class, a different Unicode
 * form — the column and the query drift apart, searching for a name that exists
 * returns nothing, and no other test in this repo notices.
 *
 * That is also why the function lives in shared/ and not in tools/, where
 * document 6 §6 assumed it would: two implementations of this would diverge in
 * silence.
 */

const cases: Array<{ step: string; input: string; expected: string }> = [
  { step: 'lowercases', input: 'LAUTARO MARTINEZ', expected: 'lautaro martinez' },
  { step: 'strips diacritics', input: 'Vlahović', expected: 'vlahovic' },
  { step: 'drops apostrophes and punctuation', input: "N'Dicka", expected: 'ndicka' },
  { step: 'collapses runs of whitespace', input: '  Thuram   Marcus ', expected: 'thuram marcus' },
]

describe('normalizeName', () => {
  it.each(cases)('$step: "$input" → "$expected"', ({ input, expected }) => {
    expect(normalizeName(input)).toBe(expected)
  })

  /**
   * Reconciliation normalises the same string more than once — once when reading
   * the listone, again when comparing against a past season. A step that is not
   * idempotent would make the second pass disagree with the first, and the
   * mismatch would look like a missing player rather than a broken function.
   */
  it('is idempotent', () => {
    for (const { input } of cases) {
      const once = normalizeName(input)
      expect(normalizeName(once)).toBe(once)
    }
  })
})

/**
 * The rotation of document 4 §6, which keeps ten backups and deletes the rest.
 *
 * It is tested for one reason: it does nothing at all until an eleventh import,
 * and until then a broken rotation and a correct one are the same empty list.
 * The eleventh import happens months later, alone, on a database that by then
 * has an auction in it.
 */
describe('backupsToPrune', () => {
  // Zero-padded on purpose. Unpadded, the tenth name grows a digit and sorts
  // before the first — which is the very failure the sortable stamp prevents,
  // and it showed up here first.
  const name = (n: number): string =>
    `fanta-help-202609${String(n).padStart(2, '0')}T120000000.db`

  it('keeps the newest and returns exactly the overflow', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => name(i))
    expect(backupsToPrune(twelve, 10)).toEqual([name(0), name(1)])
  })

  /** The off-by-one that matters: at the limit nothing is deleted yet. */
  it('deletes nothing when the folder holds exactly the limit', () => {
    const ten = Array.from({ length: 10 }, (_, i) => name(i))
    expect(backupsToPrune(ten, 10)).toEqual([])
  })

  /**
   * readdir does not promise an order, so the function sorts. Feeding it the
   * newest first must not make it delete the newest.
   */
  it('sorts by name instead of trusting the order it is given', () => {
    const shuffled = [name(3), name(0), name(2), name(1)]
    expect(backupsToPrune(shuffled, 2)).toEqual([name(0), name(1)])
  })
})

/**
 * The derived metrics of document 1 §6, and the one thing they all share: what
 * they do when they cannot answer.
 *
 * Six of the eight divide by a statistic that is legitimately zero — a player
 * with no rated match, a squad player with no start, a goalkeeper who never
 * started. `0 / 0` is `NaN`, which renders as "NaN" and sorts wherever it likes;
 * substituting zero is worse, because it is a *plausible* number that means the
 * opposite of the truth: a striker who never played would show the best malus
 * rate on the page and sort above everyone who actually played clean.
 */
describe('metriche derivate', () => {
  it('computes the document\'s own example', () => {
    // Lautaro in the mock of document 2 §4.4: FM 9,12 − MV 6,41 = +2,71
    expect(bonusIndex(9.12, 6.41)).toBeCloseTo(2.71, 2)
  })

  it('divides reliability by the named constant, not a literal', () => {
    expect(MATCHDAYS).toBe(38)
    expect(reliability(19)).toBeCloseTo(0.5, 10)
  })

  it('weighs a red card twice, and counts own goals', () => {
    // 2 gialli + 1 rosso×2 + 1 autogol = 5, su 10 partite a voto
    expect(malusRate(2, 1, 1, 10)).toBeCloseTo(0.5, 10)
  })

  it.each([
    ['bonusIndex senza FM', bonusIndex(null, 6.4)],
    ['bonusIndex senza MV', bonusIndex(9.1, null)],
    ['reliability senza Pv', reliability(null)],
    ['malusRate su zero partite a voto', malusRate(2, 0, 0, 0)],
    ['malusRate senza cartellini', malusRate(null, 0, 0, 10)],
    ['concededPerMatch su zero partite', concededPerMatch(12, 0)],
    ['startShare senza lo stadio FBref', startShare(null, null)],
    ['startShare su zero presenze', startShare(0, 0)],
    ['minutesPerMatch su zero presenze', minutesPerMatch(900, 0)],
    ['cleanSheetRate per chi non ha mai iniziato', cleanSheetRate(3, 0)],
    ['convenience su quotazione zero', convenience(80, 0)],
    ['convenience senza punteggio', convenience(null, 20)],
  ])('%s è null, non zero e non NaN', (_label, value) => {
    expect(value).toBeNull()
  })

  it('still answers when the numerator is legitimately zero', () => {
    // Nessun malus in dieci partite è un fatto, non un dato mancante.
    expect(malusRate(0, 0, 0, 10)).toBe(0)
    expect(cleanSheetRate(0, 12)).toBe(0)
  })
})
