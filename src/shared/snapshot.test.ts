import { describe, expect, it } from 'vitest'
import {
  canonicalize,
  canonicalJson,
  hashOf,
  snapshotReport,
  SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT_VERSION,
  type SnapshotContent,
  type SnapshotFile,
} from './snapshot'

/**
 * I quattro casi del documento 6 §4, che li assegna a questo file per nome.
 *
 * «La serializzazione canonica, che se si rompe si rompe in silenzio e te ne
 * accorgi fra un anno»: è l'unica cosa qui dentro che non ha un modo di
 * fallire rumorosamente, perché due impronte diverse per lo stesso contenuto
 * non rompono niente finché qualcuno non prova a confrontarle — cioè l'anno
 * prossimo, quando arriveranno le versioni degli altri partecipanti.
 *
 * I test guardano la **stringa canonica** e non l'impronta. L'impronta si
 * calcola nel main, perché sha256 vuole `node:crypto` e `shared` non dipende da
 * Node — regola 3 — ed è `sha256(canonicalize(x))`, una funzione totale della
 * stringa: due stringhe uguali non hanno nessun modo di dare due impronte
 * diverse. Il caso opposto, due stringhe diverse con la stessa impronta, è una
 * collisione di sha256 e non un difetto di questo file.
 */

const league: SnapshotContent['league'] = {
  uuid: '1d47',
  name: 'Lega degli Amici',
  seasonId: '2026-27',
  mode: 'classic',
  auctionFormat: 'call',
  budget: 500,
  minBid: 1,
  defenseModifier: false,
  slots: { P: 3, D: 8, C: 8, A: 6 },
}

const teams: SnapshotContent['teams'] = [
  { uuid: 'aa01', name: 'Real Fanta', manager: 'Edoardo', orderIndex: 0 },
  { uuid: 'bb02', name: 'Bomber Team', manager: null, orderIndex: 1 },
]

const purchases: SnapshotContent['purchases'] = [
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
    teamUuid: 'bb02',
    playerIdentityKey: 'fc-2431',
    playerName: 'Dimarco',
    playerTeam: 'Inter',
    price: 31,
    slotRole: 'D',
  },
]

const content: SnapshotContent = { league, teams, purchases }

describe('la serializzazione canonica dello snapshot, documento 1 §7', () => {
  it('mette le chiavi in ordine, a ogni livello', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  /** La prima riga del documento 6 §4. */
  it('stesso contenuto con le chiavi in ordine diverso, stessa stringa', () => {
    const altro: SnapshotContent = {
      purchases: content.purchases,
      league: {
        slots: { A: 6, C: 8, D: 8, P: 3 },
        minBid: 1,
        budget: 500,
        defenseModifier: false,
        auctionFormat: 'call',
        mode: 'classic',
        seasonId: '2026-27',
        name: 'Lega degli Amici',
        uuid: '1d47',
      },
      teams: content.teams,
    }
    expect(canonicalize(altro)).toBe(canonicalize(content))
  })

  /** La seconda: l'ordine di una serata non è un contenuto. */
  it('stessi acquisti in ordine diverso nell’array, stessa stringa', () => {
    expect(canonicalize({ ...content, purchases: [...purchases].reverse() })).toBe(
      canonicalize(content),
    )
  })

  /**
   * E le squadre, che l'invariante 15 non nomina.
   *
   * Senza il riordino, la stessa lega letta con un `ORDER BY` diverso darebbe
   * due impronte. `orderIndex` resta dentro ogni squadra, quindi l'ordine vero
   * non si perde: cambia solo l'ordine dell'array, che non è un dato.
   */
  it('e le squadre in ordine diverso, pure', () => {
    expect(canonicalize({ ...content, teams: [...teams].reverse() })).toBe(canonicalize(content))
  })

  /** La terza. Un credito, che è il passo più piccolo che esista qui. */
  it('un prezzo cambiato di un credito, stringa diversa', () => {
    const caro = purchases.map((p) => (p.uuid === 'cc19' ? { ...p, price: 48 } : p))
    expect(canonicalize({ ...content, purchases: caro })).not.toBe(canonicalize(content))
  })

  /**
   * La quarta: «metadati di produzione diversi, contenuto identico → stesso
   * hash». Il tipo lo rende vero per costruzione — `canonicalize` prende un
   * `SnapshotContent`, che i metadati non li ha — e il test lo esercita
   * comunque, partendo dal file intero come lo si scrive su disco.
   */
  it('firmato da due persone diverse, stessa stringa', () => {
    const file = (instanceUuid: string, label: string): SnapshotFile => ({
      format: SNAPSHOT_FORMAT,
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      producedBy: { instanceUuid, label, role: 'admin' },
      snapshot: { uuid: '4b81', version: 1, createdAt: 1725100000, contentHash: 'sha256:non-letto' },
      ...content,
    })
    const mio = file('9f2c', 'PC di Edoardo')
    const suo = file('7a10', 'Portatile di Marco')
    expect(canonicalize(suo)).toBe(canonicalize(mio))
  })

  /**
   * Due versioni della stessa lega hanno lo stesso contenuto solo se il
   * contenuto è lo stesso: `version` e `createdAt` stanno nei metadati, non qui.
   * Cristallizzare due volte senza toccare niente deve dare la stessa impronta,
   * ed è il modo in cui il resoconto può dire «non è cambiato niente».
   */
  it('la stessa lega cristallizzata due volte dà la stessa stringa', () => {
    expect(canonicalize({ ...content })).toBe(canonicalize(content))
  })

  /**
   * `JSON.stringify` trasforma `NaN` e `Infinity` in `null` senza dire niente, e
   * un prezzo diventato NaN a monte entrerebbe nell'impronta come «prezzo
   * assente» — indistinguibile da un prezzo che manca davvero, e per sempre,
   * perché uno snapshot non si riscrive.
   */
  it('si rifiuta di serializzare un numero che non è un numero', () => {
    expect(() => canonicalJson({ price: Number.NaN })).toThrow()
    expect(() => canonicalJson({ price: Number.POSITIVE_INFINITY })).toThrow()
  })

  it('lo zero negativo è zero', () => {
    expect(canonicalJson({ n: -0 })).toBe(canonicalJson({ n: 0 }))
  })

  /** `undefined` non è JSON: una chiave che non c'è e una vuota sono la stessa. */
  it('una chiave indefinita non entra nella stringa', () => {
    expect(canonicalJson({ a: 1, b: undefined as never })).toBe('{"a":1}')
  })

  /**
   * La forma esatta, scritta per intero.
   *
   * Tutti i test qui sopra confrontano due stringhe fra loro, e a un confronto
   * del genere va bene **qualunque** ordine purché sia sempre lo stesso:
   * invertire il verso dell'ordinamento per `uuid` li lascia tutti verdi, e la
   * mutazione che lo fa è sopravvissuta. Non è una riga inutile — è che nessun
   * test diceva quale sia la forma, e la forma è il contratto: il §7 la
   * descrive perché un domani un'altra implementazione dovrà produrre la stessa
   * impronta sugli stessi dati, e a quel punto «deterministico» non basta più.
   *
   * Se questa riga cambia, o è un errore o è un `formatVersion` nuovo.
   */
  it('ha esattamente questa forma', () => {
    expect(canonicalize(content)).toBe(
      '{"league":{"auctionFormat":"call","budget":500,"defenseModifier":false,"minBid":1,' +
        '"mode":"classic","name":"Lega degli Amici","seasonId":"2026-27",' +
        '"slots":{"A":6,"C":8,"D":8,"P":3},"uuid":"1d47"},' +
        '"purchases":[{"playerIdentityKey":"fc-2170","playerName":"Martinez L.",' +
        '"playerTeam":"Inter","price":47,"slotRole":"A","teamUuid":"aa01","uuid":"cc19"},' +
        '{"playerIdentityKey":"fc-2431","playerName":"Dimarco","playerTeam":"Inter",' +
        '"price":31,"slotRole":"D","teamUuid":"bb02","uuid":"dd20"}],' +
        '"teams":[{"manager":"Edoardo","name":"Real Fanta","orderIndex":0,"uuid":"aa01"},' +
        '{"manager":null,"name":"Bomber Team","orderIndex":1,"uuid":"bb02"}]}',
    )
  })

  /**
   * `sort` muta, e il chiamante ci scrive dentro il file che poi pubblica.
   *
   * Il fissato è **all'incontrario apposta**. Con gli acquisti già in ordine di
   * `uuid` — come sono scritti in cima a questo file — riordinarli sul posto non
   * li cambia, il test passa comunque, e la mutazione che toglie la copia
   * sopravvive: la guardia non è mai stata messa alla prova. È il quarto modo in
   * cui il `CLAUDE.md` dice che questa prova mente, «il caso che dài alla
   * guardia può non esistere nei dati».
   */
  it('non riordina gli array che gli passi', () => {
    const alrovescio = [...purchases].reverse()
    const comeErano = [...alrovescio]
    canonicalize({ ...content, purchases: alrovescio })
    expect(alrovescio).toEqual(comeErano)
  })
})


describe('l’impronta, invariante 15', () => {
  /**
   * Quello che finisce sotto sha256 è **la forma canonica**, e non il contenuto
   * come capita.
   *
   * Il digest è `(s) => s`, quindi il test legge la stringa che l'algoritmo
   * riceverebbe. Senza questa prova, sostituire `canonicalize` con
   * `JSON.stringify` nel calcolo dell'impronta lasciava la suite intera verde:
   * gli snapshot restavano confrontabili con sé stessi e smettevano di esserlo
   * con quelli di chiunque altro, che è il giorno in cui te ne accorgi.
   */
  it('dà in pasto al digest la forma canonica, non il contenuto così com’è', () => {
    expect(hashOf(content, (s) => s)).toBe(`sha256:${canonicalize(content)}`)
  })

  it('porta davanti il nome dell’algoritmo, come il §7', () => {
    expect(hashOf(content, () => 'a91f')).toBe('sha256:a91f')
  })

  it('due contenuti uguali scritti in ordine diverso arrivano identici al digest', () => {
    const preso: string[] = []
    hashOf(content, (s) => (preso.push(s), s))
    hashOf({ ...content, purchases: [...purchases].reverse() }, (s) => (preso.push(s), s))
    expect(preso[0]).toBe(preso[1])
  })
})

describe('i numeri del resoconto, documento 2 §4.11', () => {
  it('somma la spesa per squadra e per reparto, e i crediti rimasti', () => {
    const r = snapshotReport(content)
    expect(r.teams.map((t) => [t.name, t.players, t.spent, t.left])).toEqual([
      ['Real Fanta', 1, 47, 453],
      ['Bomber Team', 1, 31, 469],
    ])
    expect(r.teams[0].byRole.A).toEqual({ spent: 47, players: 1 })
    expect(r.teams[0].byRole.D).toEqual({ spent: 0, players: 0 })
  })

  it('le squadre restano nell’ordine della lega, non in quello dell’array', () => {
    const r = snapshotReport({ ...content, teams: [...teams].reverse() })
    expect(r.teams.map((t) => t.name)).toEqual(['Real Fanta', 'Bomber Team'])
  })

  it('nomina il giocatore più pagato, chi ha speso per l’attacco e chi ha più crediti', () => {
    const r = snapshotReport(content)
    expect(r.topPurchase?.playerName).toBe('Martinez L.')
    expect(r.topAttack?.name).toBe('Real Fanta')
    expect(r.richest?.name).toBe('Bomber Team')
  })

  /**
   * I crediti rimasti pareggiano quasi sempre — a fine asta sono zero per tutti
   * — quindi la regola dei pari non è un caso di scuola: senza, la stessa lega
   * letta due volte nominerebbe due vincitori diversi.
   */
  it('a parità di crediti sceglie sempre la stessa squadra', () => {
    const pari: SnapshotContent = {
      ...content,
      purchases: [purchases[0], { ...purchases[1], price: 47 }],
    }
    expect(snapshotReport(pari).richest?.name).toBe('Real Fanta')
    expect(snapshotReport({ ...pari, teams: [...teams].reverse() }).richest?.name).toBe('Real Fanta')
  })

  it('a parità di prezzo sceglie sempre lo stesso acquisto', () => {
    const pari: SnapshotContent = {
      ...content,
      purchases: [purchases[0], { ...purchases[1], price: 47 }],
    }
    expect(snapshotReport(pari).topPurchase?.uuid).toBe('cc19')
    expect(
      snapshotReport({ ...pari, purchases: [...pari.purchases].reverse() }).topPurchase?.uuid,
    ).toBe('cc19')
  })

  /** Nessun attaccante comprato: la domanda non ha una risposta vera. */
  it('non nomina nessuno per l’attacco se nessuno ha comprato attaccanti', () => {
    const senzaAttacco: SnapshotContent = { ...content, purchases: [purchases[1]] }
    expect(snapshotReport(senzaAttacco).topAttack).toBeNull()
    expect(snapshotReport(senzaAttacco).topPurchase?.playerName).toBe('Dimarco')
  })

  it('una lega senza acquisti non ha un giocatore più pagato', () => {
    const vuota: SnapshotContent = { ...content, purchases: [] }
    const r = snapshotReport(vuota)
    expect(r.topPurchase).toBeNull()
    expect(r.topAttack).toBeNull()
    expect(r.teams.every((t) => t.left === 500 && t.players === 0)).toBe(true)
  })

  /**
   * Una rosa sforata: la revisione lo permette, e il resoconto registra quello
   * che è successo. `left` negativo, non zero e non nascosto.
   */
  it('i crediti rimasti possono essere negativi', () => {
    const sforata: SnapshotContent = {
      ...content,
      purchases: [{ ...purchases[0], price: 600 }],
    }
    expect(snapshotReport(sforata).teams[0].left).toBe(-100)
  })

  /** Un acquisto che nomina una squadra che non c'è non finisce nei totali. */
  it('scarta un acquisto orfano invece di sommarlo a nessuno', () => {
    const orfano: SnapshotContent = {
      ...content,
      purchases: [...purchases, { ...purchases[0], uuid: 'ee21', teamUuid: 'zz99' }],
    }
    expect(snapshotReport(orfano).teams.reduce((n, t) => n + t.players, 0)).toBe(2)
  })
})
