import { describe, expect, it } from 'vitest'
import { mapClubs, matchWithinClub } from './matching'

/**
 * Document 4 §5 names the case this file exists for: **two Thuram**. Matching on
 * the surname alone fuses Marcus and Khéphren into one person with absurd
 * numbers, and nothing looks broken — the row is simply wrong, and stays wrong.
 *
 * That is why these are tested and, say, the report layout is not. A parser that
 * breaks throws; a match that breaks returns somebody else's season.
 */

const THURAM = [
  { name: 'Marcus Thuram', team: 'Inter', birthYear: 1997 },
  { name: 'Khéphren Thuram', team: 'Juventus', birthYear: 2001 },
]

describe('mapClubs', () => {
  it('riconosce le squadre per parola condivisa, senza una tabella da aggiornare ogni anno', () => {
    const mapping = mapClubs(['Inter', 'Milan', 'Verona'], ['Inter', 'AC Milan', 'Hellas Verona'])
    expect(mapping.byForeign.get('AC Milan')).toBe('Milan')
    expect(mapping.byForeign.get('Hellas Verona')).toBe('Verona')
    expect(mapping.byForeign.get('Inter')).toBe('Inter')
    expect(mapping.unmapped).toEqual([])
  })

  it('nomina il club che non aggancia invece di perderlo', () => {
    const mapping = mapClubs(['Inter', 'Milan'], ['Sassuolo'])
    expect(mapping.unmapped).toEqual(['Sassuolo'])
    expect(mapping.byForeign.size).toBe(0)
  })

  it('si ferma invece di scegliere quando un club ne aggancia due', () => {
    const mapping = mapClubs(['Verona', 'Hellas Ragusa'], ['Hellas Verona'])
    expect(mapping.ambiguous).toHaveLength(1)
    expect(mapping.byForeign.size).toBe(0)
  })
})

describe('matchWithinClub', () => {
  it('separa i due Thuram con il club, che è il punto di tutto il documento §5', () => {
    const inter = matchWithinClub({ name: 'Thuram', team: 'Inter' }, THURAM)
    const juve = matchWithinClub({ name: 'Thuram', team: 'Juventus' }, THURAM)
    expect(inter).toEqual({ kind: 'matched', to: THURAM[0] })
    expect(juve).toEqual({ kind: 'matched', to: THURAM[1] })
  })

  it("non fa punteggio con un'iniziale, o due estranei si aggancerebbero sulla stessa lettera", () => {
    // 'Rossi M.' e 'M. Bianchi' condividono la parola 'm' e nient'altro. Contarla
    // li fonderebbe in una corrispondenza che sembra buona come le altre.
    const candidates = [{ name: 'M. Bianchi', team: 'Empoli', birthYear: 1999 }]
    expect(matchWithinClub({ name: 'Rossi M.', team: 'Empoli' }, candidates)).toEqual({ kind: 'none' })
  })

  it("usa però l'iniziale per spareggiare, che è l'unica cosa che distingue i due Martínez", () => {
    const candidates = [
      { name: 'L. Martínez', team: 'Inter', birthYear: 1997 },
      { name: 'J. Martínez', team: 'Inter', birthYear: 1993 },
    ]
    expect(matchWithinClub({ name: 'Martinez L.', team: 'Inter' }, candidates)).toEqual({
      kind: 'matched',
      to: candidates[0],
    })
  })

  it("aggancia il cognome anche quando il listone ci appiccica un'iniziale", () => {
    expect(matchWithinClub({ name: 'Thuram M.', team: 'Inter' }, THURAM)).toEqual({
      kind: 'matched',
      to: THURAM[0],
    })
  })

  it('preferisce chi condivide più parole', () => {
    const candidates = [
      { name: 'Lorenzo Colombo', team: 'Empoli', birthYear: 2002 },
      { name: 'Lautaro Martinez', team: 'Empoli', birthYear: 1997 },
    ]
    const outcome = matchWithinClub({ name: 'Lorenzo Colombo', team: 'Empoli' }, candidates)
    expect(outcome).toEqual({ kind: 'matched', to: candidates[0] })
  })

  it('dichiara ambiguo invece di indovinare fra due omonimi dello stesso club', () => {
    const candidates = [
      { name: 'Lorenzo Colombo', team: 'Empoli', birthYear: 2002 },
      { name: 'Andrea Colombo', team: 'Empoli', birthYear: 1996 },
    ]
    expect(matchWithinClub({ name: 'Colombo', team: 'Empoli' }, candidates)).toEqual({
      kind: 'ambiguous',
      between: ['Lorenzo Colombo', 'Andrea Colombo'],
    })
  })

  it("scioglie l'ambiguità con l'anno di nascita, quando overrides.json ne dà uno", () => {
    const candidates = [
      { name: 'Lorenzo Colombo', team: 'Empoli', birthYear: 2002 },
      { name: 'Andrea Colombo', team: 'Empoli', birthYear: 1996 },
    ]
    expect(matchWithinClub({ name: 'Colombo', team: 'Empoli' }, candidates, 1996)).toEqual({
      kind: 'matched',
      to: candidates[1],
    })
  })

  it("rifiuta il candidato che l'abbreviazione del listone smentisce", () => {
    // La Roma schiera due Pellegrini. FBref elenca chi è sceso in campo, quindi
    // Luca — che nel listone ha Pv 0 — non compare. Senza veto, Luca si prendeva
    // le duemila e duecento minuti di Lorenzo e il rapporto diceva 0 mancanti.
    const soloLorenzo = [{ name: 'Lorenzo Pellegrini', team: 'Roma', birthYear: 1996 }]
    expect(matchWithinClub({ name: 'Pellegrini Lo.', team: 'Roma' }, soloLorenzo)).toEqual({
      kind: 'matched',
      to: soloLorenzo[0],
    })
    expect(matchWithinClub({ name: 'Pellegrini Lu.', team: 'Roma' }, soloLorenzo)).toEqual({ kind: 'none' })
  })

  it("rifiuta il candidato che l'anno di nascita smentisce, anche se è l'unico", () => {
    const soloLorenzo = [{ name: 'Lorenzo Pellegrini', team: 'Roma', birthYear: 1996 }]
    expect(matchWithinClub({ name: 'Pellegrini', team: 'Roma' }, soloLorenzo, 2003)).toEqual({ kind: 'none' })
    expect(matchWithinClub({ name: 'Pellegrini', team: 'Roma' }, soloLorenzo, 1996)).toEqual({
      kind: 'matched',
      to: soloLorenzo[0],
    })
  })

  it('non aggancia niente fuori dal club', () => {
    expect(matchWithinClub({ name: 'Thuram', team: 'Napoli' }, THURAM)).toEqual({ kind: 'none' })
  })
})
