import { describe, expect, it } from 'vitest'
import { parseRoster } from './apifootball'

/**
 * The roster is saved by hand, so it arrives in whatever form was convenient
 * that day. Recognising the two endpoints — and refusing anything else by name
 * rather than producing nobody — is the whole job of this file.
 */

const SQUADS = {
  get: 'players/squads',
  response: [
    {
      team: { id: 505, name: 'Inter' },
      players: [
        { id: 30435, name: 'Lautaro Martínez', age: 28, number: 10, position: 'Attacker' },
        { id: 1234, name: 'Marcus Thuram', age: 28, number: 9, position: 'Attacker' },
      ],
    },
  ],
}

const PLAYERS = {
  get: 'players',
  response: [
    {
      player: {
        id: 30435,
        name: 'L. Martínez',
        firstname: 'Lautaro Javier',
        lastname: 'Martínez',
        birth: { date: '1997-08-22', place: 'Bahía Blanca', country: 'Argentina' },
      },
      statistics: [{ team: { id: 505, name: 'Inter' } }],
    },
  ],
}

describe('parseRoster', () => {
  it('legge una risposta di /players/squads', () => {
    const roster = parseRoster(SQUADS, 'inter.json')
    expect(roster).toHaveLength(2)
    expect(roster[0]).toEqual({ apiFootballId: 30435, name: 'Lautaro Martínez', team: 'Inter', birthYear: null })
  })

  it("sostituisce il nome abbreviato con quello per esteso, perché un'iniziale non aggancia niente", () => {
    // 'L. Martínez' si riduce a ['martinez']: dentro l'Inter basterebbe un
    // secondo Martínez per renderlo ambiguo, e il nome intero c'è già nei campi.
    expect(parseRoster(PLAYERS, 'p1.json')[0]).toEqual({
      apiFootballId: 30435,
      name: 'Lautaro Javier Martínez',
      team: 'Inter',
      birthYear: 1997,
    })
  })

  it("accetta l'array nudo, senza la busta della risposta", () => {
    expect(parseRoster(SQUADS.response, 'inter.json')).toHaveLength(2)
  })

  it('rifiuta per nome quello che non è nessuna delle due forme', () => {
    expect(() => parseRoster({ response: [{ nome: 'Inter' }] }, 'strano.json')).toThrow(
      /non è né una risposta di \/players\/squads né una di \/players/,
    )
  })
})
