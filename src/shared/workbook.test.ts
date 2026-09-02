import { describe, expect, it } from 'vitest'
import { sheetName, workbookSheets } from './workbook'
import { SNAPSHOT_FORMAT, SNAPSHOT_FORMAT_VERSION, type SnapshotFile } from './snapshot'

/**
 * Il foglio del documento 2 §4.11, provato senza aprire exceljs.
 *
 * Vale la pena perché è l'unico artefatto dell'app che finisce **in mano ad
 * altri**, e nessuno lo riaprirà per controllare: se una colonna è sbagliata, la
 * scopre chi lo riceve, quando non c'è più niente da fare.
 */

const file: SnapshotFile = {
  format: SNAPSHOT_FORMAT,
  formatVersion: SNAPSHOT_FORMAT_VERSION,
  producedBy: { instanceUuid: '9f2c', label: 'PC di Edoardo', role: 'admin' },
  snapshot: { uuid: '4b81', version: 1, createdAt: 1725100000000, contentHash: 'sha256:a91f' },
  league: {
    uuid: '1d47',
    name: 'Lega degli Amici',
    seasonId: '2026-27',
    mode: 'classic',
    auctionFormat: 'call',
    budget: 500,
    minBid: 1,
    defenseModifier: false,
    slots: { P: 3, D: 8, C: 8, A: 6 },
  },
  teams: [
    { uuid: 'aa01', name: 'Real Fanta', manager: 'Edoardo', orderIndex: 0 },
    { uuid: 'bb02', name: 'Bomber Team', manager: null, orderIndex: 1 },
  ],
  purchases: [
    {
      uuid: 'cc19',
      teamUuid: 'aa01',
      playerIdentityKey: 'fc-2170',
      playerName: 'Martinez L.',
      playerTeam: 'Inter',
      price: 47,
      slotRole: 'A',
    },
    {
      uuid: 'dd20',
      teamUuid: 'aa01',
      playerIdentityKey: 'fc-2431',
      playerName: 'Dimarco',
      playerTeam: 'Inter',
      price: 31,
      slotRole: 'D',
    },
    {
      uuid: 'ee21',
      teamUuid: 'bb02',
      playerIdentityKey: 'fc-9',
      playerName: 'Svilar',
      playerTeam: 'Roma',
      price: 12,
      slotRole: 'P',
    },
  ],
}

describe('il nome di un foglio, i limiti che Excel non spiega', () => {
  it('tiene il nome della squadra quando si può', () => {
    expect(sheetName('Real Fanta', [])).toBe('Real Fanta')
  })

  /** `/` in un nome di squadra è plausibile e rompe il file senza dire perché. */
  it('toglie i caratteri che Excel rifiuta', () => {
    expect(sheetName('Real/Fanta', [])).toBe('Real Fanta')
    expect(sheetName('A:B\\C?D*E[F]G', [])).toBe('A B C D E F G')
  })

  it('sta nei trentuno caratteri', () => {
    const lungo = 'Squadra con un nome davvero interminabile'
    expect(sheetName(lungo, []).length).toBe(31)
  })

  /**
   * Il caso vero: i nomi delle squadre sono unici dentro la lega, ma due nomi
   * che differiscono dopo il trentunesimo carattere diventano lo stesso foglio,
   * e due fogli omonimi sono un file che non si apre.
   */
  it('non ripete un nome già preso, nemmeno dopo il troncamento', () => {
    const a = 'Gli Invincibili del Fantacalcio 2026'
    const b = 'Gli Invincibili del Fantacalcio 2027'
    const primo = sheetName(a, ['Riepilogo'])
    const secondo = sheetName(b, ['Riepilogo', primo])
    // I due nomi sono diversi solo dal trentaduesimo carattere, quindi troncati
    // sono identici: è la collisione che il file non tollera.
    expect(a.slice(0, 31)).toBe(b.slice(0, 31))
    expect(secondo).not.toBe(primo)
    expect(secondo.length).toBeLessThanOrEqual(31)
    expect(secondo.endsWith(' (2)')).toBe(true)
  })

  it('confronta senza distinguere le maiuscole, come fa Excel', () => {
    expect(sheetName('real fanta', ['Real Fanta'])).toBe('real fanta (2)')
  })

  it('una squadra chiamata solo con caratteri vietati ha comunque un foglio', () => {
    expect(sheetName('///', [])).toBe('Squadra')
  })
})

describe('i fogli dell’export, documento 2 §4.11', () => {
  const sheets = workbookSheets(file)

  it('è un riepilogo più una scheda per squadra, in quest’ordine', () => {
    expect(sheets.map((s) => s.name)).toEqual(['Riepilogo', 'Real Fanta', 'Bomber Team'])
  })

  it('il riepilogo porta spesa, crediti rimasti e spesa per reparto', () => {
    expect(sheets[0].rows[0]).toEqual([
      'squadra',
      'allenatore',
      'giocatori',
      'spesa',
      'in mano',
      'spesa portieri',
      'spesa difensori',
      'spesa centrocampisti',
      'spesa attaccanti',
    ])
    expect(sheets[0].rows[1]).toEqual(['Real Fanta', 'Edoardo', 2, 78, 422, 0, 31, 0, 47])
    // Senza allenatore la cella è vuota, non la stringa «null».
    expect(sheets[0].rows[2][1]).toBeNull()
  })

  it('la scheda di una squadra elenca la rosa per reparto e chiude con i totali', () => {
    const rosa = sheets[1].rows
    expect(rosa[0]).toEqual(['ruolo', 'giocatore', 'club', 'prezzo'])
    expect(rosa[1]).toEqual(['D', 'Dimarco', 'Inter', 31])
    expect(rosa[2]).toEqual(['A', 'Martinez L.', 'Inter', 47])
    expect(rosa.at(-2)).toEqual(['totale', null, null, 78])
    expect(rosa.at(-1)).toEqual(['in mano', null, null, 422])
  })

  it('i prezzi sono numeri, non testo: chi riceve il file li somma', () => {
    for (const sheet of sheets.slice(1)) {
      for (const row of sheet.rows.slice(1)) {
        if (row.length > 0 && row[0] !== 'totale' && row[0] !== 'in mano') {
          expect(typeof row[3]).toBe('number')
        }
      }
    }
  })

  it('una squadra senza acquisti ha comunque la sua scheda', () => {
    const sola = workbookSheets({ ...file, purchases: [] })
    expect(sola.map((s) => s.name)).toEqual(['Riepilogo', 'Real Fanta', 'Bomber Team'])
    expect(sola[1].rows.at(-2)).toEqual(['totale', null, null, 0])
  })
})
