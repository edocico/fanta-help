import { describe, expect, it } from 'vitest'
import { backupsToPrune, normalizeName } from './domain'

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
