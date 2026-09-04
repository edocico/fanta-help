import { describe, expect, it } from 'vitest'
import { ABBREVIATIONS, glossary } from '@shared/glossary'

/**
 * The key set written out in full, not derived.
 *
 * T17 paid for this shape: a test that compares two outputs of the same
 * function is happy with *any* answer as long as it is always the same one.
 * `expect(ABBREVIATIONS).toEqual(Object.keys(glossary))` would pass with an
 * empty glossary, and it would pass the day somebody deletes an entry. The
 * golden value is the contract, and adding or removing an abbreviation is meant
 * to be a deliberate act that shows up in a diff of this line.
 *
 * The order is the contract too: the reference panel renders in it, and the
 * metrics follow the players table's own column order — see the note on
 * `ABBREVIATIONS`, which says where the four that are not columns sit.
 */
const GOLDEN = [
  'ruo',
  'squa',
  'qt.',
  'qt. iniziale',
  'FVM',
  'FM',
  'MV',
  'Pv',
  'bon',
  'pt.',
  'pr.',
  'tit.',
  'min',
  'CS',
  'cr',
  'max',
  '#',
  '★',
]

describe('the glossary', () => {
  it('holds exactly the eighteen abbreviations the app draws, in screen order', () => {
    expect(ABBREVIATIONS).toEqual(GOLDEN)
  })

  it('gives every abbreviation both an expansion and an explanation', () => {
    for (const [key, entry] of Object.entries(glossary)) {
      expect(entry.full, `${key}: manca l'espansione`).not.toBe('')
      expect(entry.explains, `${key}: manca la spiegazione`).not.toBe('')
    }
  })

  /**
   * Document 7 §10: "expansion and explanation are two different things".
   * Repeating the key, or repeating the expansion, is how an entry quietly
   * becomes half an entry — it still has two fields and still says one thing.
   */
  it('never lets a field repeat what the reader already has', () => {
    for (const [key, entry] of Object.entries(glossary)) {
      expect(entry.full.toLowerCase(), `${key}: l'espansione ripete la sigla`).not.toBe(
        key.toLowerCase(),
      )
      expect(entry.explains, `${key}: la spiegazione ripete l'espansione`).not.toBe(entry.full)
    }
  })

  /**
   * Two abbreviations with the same expansion mean one of the two columns is
   * lying about what it holds. It is the shape the auction screen actually hit:
   * `max` was drawn twice, for the team's maximum bid and for the ceiling the
   * user sets on an objective, a few centimetres apart.
   */
  it('never spells two abbreviations the same way', () => {
    const spelled = Object.values(glossary).map((e) => e.full)
    expect(new Set(spelled).size).toBe(spelled.length)
  })

  /**
   * One register, so the popover reads as one voice: the expansion is a noun
   * phrase and stops without a full stop, the explanation is whole sentences and
   * ends with one.
   */
  it('keeps one register: a noun phrase, then sentences', () => {
    for (const [key, entry] of Object.entries(glossary)) {
      expect(entry.full.endsWith('.'), `${key}: l'espansione non è una frase`).toBe(false)
      expect(entry.explains.endsWith('.'), `${key}: la spiegazione non chiude`).toBe(true)
      expect(entry.full[0], `${key}: l'espansione non è maiuscola`).toBe(
        entry.full[0]?.toUpperCase(),
      )
    }
  })
})
