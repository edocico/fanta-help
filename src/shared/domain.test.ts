import { describe, expect, it } from 'vitest'
import {
  backupsToPrune,
  bonusIndex,
  canTransition,
  chartBounds,
  coherenceWarnings,
  DEFAULT_SLOTS,
  frozen,
  hasHistory,
  LEAGUE_STATUSES,
  LEAGUE_TRANSITIONS,
  move,
  permutationOf,
  rulesEditable,
  seasonWindow,
  cleanSheetRate,
  concededPerMatch,
  convenience,
  malusRate,
  MATCHDAYS,
  minutesPerMatch,
  normalizeName,
  reliability,
  startShare,
  TEAM_COLORS,
  teamListEditable,
  totalSlots,
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

/**
 * Document 2 §8 and §9, the two rules the player panel of T10 rests on.
 *
 * They are here rather than in the component because both are arithmetic on
 * data, and because the §8 rule is the one deliberate exception to "uno stato
 * vuoto è un invito ad agire": it has to name the window it looked in, read
 * from the seasons that are actually present rather than written by hand.
 */
describe('lo storico del giocatore, documento 2 §8 e §9', () => {
  it('nomina la finestra leggendola dalle stagioni presenti', () => {
    expect(seasonWindow(['2023-24', '2024-25', '2025-26'])).toBe('2023-24 → 2025-26')
  })

  it('ordina le stagioni, comunque arrivino', () => {
    expect(seasonWindow(['2025-26', '2023-24', '2024-25'])).toBe('2023-24 → 2025-26')
  })

  it('non finge un intervallo quando la stagione è una sola', () => {
    expect(seasonWindow(['2025-26'])).toBe('2025-26')
  })

  it('senza stagioni non ha finestra da nominare', () => {
    expect(seasonWindow([])).toBeNull()
  })

  /**
   * §9: «Lo storico si nasconde solo quando non c'è, mai perché è poco», e «il
   * caso davvero vuoto riguarda 108 giocatori su 524».
   *
   * Quel numero è la specifica, ed è quello che dice dove passa il confine: 108
   * è il conteggio di chi non ha **nessuna stagione passata**, non di chi non ha
   * nessuna riga. Una riga per la stagione in corso ce l'hanno tutti e 524 —
   * verificato sul dataset costruito — quindi una guardia che guardasse «una
   * riga qualsiasi» sarebbe vera sempre e lo stato vuoto del §8 non comparirebbe
   * mai. La finestra che il §8 nomina, `(2023-24 → 2025-26)`, dice la stessa
   * cosa per un'altra via: lascia fuori la stagione del listone.
   *
   * La forma dei dati qui sotto è quella vera, presa dal dataset: la riga della
   * stagione in corso porta zeri, non null.
   */
  const CORRENTE = '2026-27'
  const rigaVuota = { matchesRated: 0, avgVote: null, fantaAvg: null, ownGoals: 0 }

  it('una stagione passata è storico', () => {
    expect(hasHistory({ '2024-25': { matchesRated: 4, avgVote: 6.8 } }, CORRENTE)).toBe(true)
  })

  it('quattro presenze sono storico, non "poco"', () => {
    expect(hasHistory({ '2025-26': { matchesRated: 4, avgVote: 6.8 } }, CORRENTE)).toBe(true)
  })

  /**
   * Il caso dei 108, nella forma in cui esiste davvero: la riga della stagione
   * in corso c'è e porta zeri. Il test di prima passava `{}`, una forma che nel
   * database non esiste per nessun giocatore — passava, e il caso reale le
   * sfuggiva.
   */
  it('la sola stagione in corso non è storico: è il caso dei 108 su 524', () => {
    expect(hasHistory({ [CORRENTE]: rigaVuota }, CORRENTE)).toBe(false)
  })

  it('nemmeno con qualche giornata già giocata quest\'anno', () => {
    expect(hasHistory({ [CORRENTE]: { matchesRated: 2, avgVote: 6 } }, CORRENTE)).toBe(false)
  })

  it('nessuna riga non è storico', () => {
    expect(hasHistory({}, CORRENTE)).toBe(false)
  })

  it('senza sapere qual è la stagione in corso, conta qualunque riga', () => {
    expect(hasHistory({ '2024-25': { matchesRated: 4 } }, null)).toBe(true)
  })
})

/**
 * La scala del grafico FM/MV. Una sola per le due serie, altrimenti il grafico
 * mente: due assi indipendenti fanno sembrare uguali una MV di 5,9 e una FM di
 * 9,1, che è esattamente la differenza che il lettore sta cercando.
 */
describe('la scala del grafico, documento 2 §4.5', () => {
  it('condivide una scala sola fra FM e MV', () => {
    const b = chartBounds([
      [6.0, 6.2],
      [9.1, 4.8],
    ])
    expect(b).not.toBeNull()
    expect(b!.min).toBeLessThanOrEqual(4.8)
    expect(b!.max).toBeGreaterThanOrEqual(9.1)
  })

  it('ignora i buchi invece di trattarli come zeri', () => {
    // Uno zero finto abbasserebbe il fondo della scala e schiaccerebbe le linee.
    expect(chartBounds([[6.0, null, 6.4]])!.min).toBeGreaterThan(0)
  })

  it('dà comunque un intervallo a una serie piatta, invece di dividere per zero', () => {
    const b = chartBounds([[6.5, 6.5, 6.5]])!
    expect(b.max).toBeGreaterThan(b.min)
  })

  it('senza niente da disegnare non inventa una scala', () => {
    expect(chartBounds([])).toBeNull()
    expect(chartBounds([[null, null]])).toBeNull()
  })
})

/**
 * T11. Il ciclo di vita del documento 1 §3 e le invarianti 9, 13 e 16.
 *
 * Sono qui e non in un test del servizio per la ragione del documento 6 §3: i
 * test girano su Node e il database è compilato per l'ABI di Electron. Una
 * guardia che vive dentro una query non è provabile; la stessa guardia come
 * funzione pura sì, e il servizio la chiama invece di riscriverla.
 */
describe('il ciclo di vita della lega, documento 1 §3', () => {
  it('percorre le frecce del diagramma', () => {
    expect(canTransition('setup', 'pre_auction')).toBe(true)
    expect(canTransition('pre_auction', 'auction')).toBe(true)
    expect(canTransition('auction', 'review')).toBe(true)
    expect(canTransition('review', 'closed')).toBe(true)
  })

  it('riapre un resoconto cristallizzato, e solo verso la revisione', () => {
    expect(canTransition('closed', 'review')).toBe(true)
    expect(canTransition('closed', 'auction')).toBe(false)
    expect(canTransition('closed', 'pre_auction')).toBe(false)
  })

  it('non torna indietro a mercato aperto: gli acquisti esistono già', () => {
    expect(canTransition('auction', 'pre_auction')).toBe(false)
    expect(canTransition('review', 'auction')).toBe(false)
  })

  it('non salta uno stato', () => {
    expect(canTransition('setup', 'auction')).toBe(false)
    expect(canTransition('pre_auction', 'review')).toBe(false)
    expect(canTransition('auction', 'closed')).toBe(false)
  })

  it('non resta fermo dicendo di essersi mosso', () => {
    for (const status of LEAGUE_STATUSES) expect(canTransition(status, status)).toBe(false)
  })

  /**
   * Il diagramma del documento 1 §3 ha cinque nodi e cinque frecce: le quattro in
   * avanti più la riapertura. Contarle è il solo modo di accorgersi di una
   * freccia aggiunta per comodità in un task futuro — i casi qui sopra dicono che
   * ogni freccia *attesa* c'è, non che non ce ne siano altre.
   */
  it('ha esattamente le cinque transizioni del diagramma', () => {
    const arrows = LEAGUE_STATUSES.flatMap((from) => LEAGUE_TRANSITIONS[from])
    expect(arrows).toHaveLength(5)
  })
})

describe('chi può scrivere cosa, invarianti 9, 13 e 16', () => {
  it('il regolamento si blocca quando parte l’asta, revisione compresa', () => {
    expect(rulesEditable('setup')).toBe(true)
    expect(rulesEditable('pre_auction')).toBe(true)
    expect(rulesEditable('auction')).toBe(false)
    expect(rulesEditable('review')).toBe(false)
    expect(rulesEditable('closed')).toBe(false)
  })

  it('le squadre si aggiungono e si tolgono solo prima dell’asta', () => {
    expect(teamListEditable('setup')).toBe(true)
    expect(teamListEditable('pre_auction')).toBe(true)
    expect(teamListEditable('auction')).toBe(false)
    expect(teamListEditable('review')).toBe(false)
    expect(teamListEditable('closed')).toBe(false)
  })

  it('cristallizzata vuol dire sola lettura, e solo quella', () => {
    expect(frozen('closed')).toBe(true)
    for (const status of ['setup', 'pre_auction', 'auction', 'review'] as const) {
      expect(frozen(status)).toBe(false)
    }
  })
})

describe('la rosa e le tinte, documento 2 §4.3', () => {
  it('precompila 3/8/8/6, che fanno i 25 slot di una rosa', () => {
    expect(DEFAULT_SLOTS).toEqual({ P: 3, D: 8, C: 8, A: 6 })
    expect(totalSlots(DEFAULT_SLOTS)).toBe(25)
  })

  it('offre dieci tinte, tutte diverse fra loro', () => {
    expect(TEAM_COLORS).toHaveLength(10)
    expect(new Set(TEAM_COLORS.map((c) => c.value)).size).toBe(10)
  })

  /**
   * Le tre tinte riservate del documento 2 §2 — l’ambra del denaro, il rosso del
   * già preso, il verde acqua dell’obiettivo — non possono comparire fra i colori
   * squadra: la stessa tinta direbbe due cose diverse nella stessa schermata.
   */
  it('non riusa nessuno dei tre colori che significano già qualcosa', () => {
    const reserved = ['#E8B33D', '#A8483E', '#4FB8A8']
    for (const { value } of TEAM_COLORS) expect(reserved).not.toContain(value.toUpperCase())
  })
})

describe('lo spostamento di una squadra nell’ordine', () => {
  const teams = ['a', 'b', 'c', 'd']

  it('porta l’elemento dove è stato lasciato', () => {
    expect(move(teams, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(move(teams, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('non consuma né duplica nessuno', () => {
    expect(move(teams, 1, 3)).toHaveLength(teams.length)
    expect(new Set(move(teams, 1, 3)).size).toBe(teams.length)
  })

  it('lascia la lista com’è quando il gesto non ha spostato niente', () => {
    expect(move(teams, 2, 2)).toEqual(teams)
    expect(move(teams, 0, 9)).toEqual(teams)
    expect(move(teams, -1, 1)).toEqual(teams)
  })

  it('non tocca la lista che ha ricevuto', () => {
    const original = [...teams]
    move(teams, 0, 3)
    expect(teams).toEqual(original)
  })
})

/**
 * La guardia di `team.reorder`. Il vincolo `UNIQUE (league_id, order_index)` che
 * il CLAUDE.md dice di non togliere prenderebbe comunque un riordino monco — da
 * dentro la transazione, come `UNKNOWN`, che è esattamente il modo in cui un
 * rifiuto perde il proprio messaggio.
 */
describe('il riordino accetta solo un permutazione della lista vera', () => {
  it('accetta le stesse squadre in un altro ordine', () => {
    expect(permutationOf([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2])
  })

  it('rifiuta una squadra che non è di questa lega', () => {
    expect(permutationOf([1, 2, 3], [1, 2, 9])).toBeNull()
  })

  it('rifiuta una lista monca o gonfia', () => {
    expect(permutationOf([1, 2, 3], [1, 2])).toBeNull()
    expect(permutationOf([1, 2, 3], [1, 2, 3, 4])).toBeNull()
  })

  it('rifiuta un id ripetuto, che passerebbe un controllo di sola appartenenza', () => {
    expect(permutationOf([1, 2, 3], [1, 2, 2])).toBeNull()
    // Il caso che distingue davvero il multinsieme dall'insieme: qui ogni id di
    // una lista compare nell'altra, e nessuna delle due è un riordino dell'altra.
    expect(permutationOf([1, 1, 2], [1, 2, 2])).toBeNull()
  })
})

describe('i controlli di coerenza del wizard, documento 2 §4.3 passo 3', () => {
  const slots = DEFAULT_SLOTS

  /**
   * Il listone 2026-27, contato dall'app dopo l'import del file vero: 524
   * giocatori, che è il numero che il documento 2 §9 usa per il caso dello
   * storico vuoto. Inventarlo sarebbe l'errore che il CLAUDE.md descrive — un
   * fissato scelto a mano prova che la funzione guarda *qualcosa*, non che
   * guardi il caso vero. Qui la differenza si vede: i portieri sono 63, non i
   * 120 che verrebbero da immaginare "un quinto di 524".
   */
  const listone = { P: 63, D: 186, C: 187, A: 88 }

  it('tace su una lega normale: dieci squadre e la rosa predefinita', () => {
    expect(
      coherenceWarnings({ teams: 10, slots, budget: 500, minBid: 1, available: listone }),
    ).toEqual([])
  })

  it('dice quale ruolo non basta, con i due numeri', () => {
    // Quindici squadre da sei attaccanti sono 90 posti e il listone ne ha 88.
    // Non è un caso di scuola: è la lega a quindici che qualcuno propone ogni anno.
    const warnings = coherenceWarnings({
      teams: 15,
      slots,
      budget: 500,
      minBid: 1,
      available: listone,
    })
    expect(warnings).toContainEqual({
      code: 'NOT_ENOUGH_PLAYERS',
      role: 'A',
      needed: 90,
      available: 88,
    })
    // E solo quello: portieri, difensori e centrocampisti bastano ancora.
    expect(warnings.filter((w) => w.code === 'NOT_ENOUGH_PLAYERS')).toHaveLength(1)
  })

  it('sul filo non avvisa: esattamente quanti ne servono bastano', () => {
    // 21 squadre × 3 portieri sono 63, che è esattamente quanti ne ha il listone.
    const exact = coherenceWarnings({
      teams: 21,
      slots: { P: 3, D: 8, C: 8, A: 4 },
      budget: 5000,
      minBid: 1,
      available: listone,
    })
    expect(exact.filter((w) => w.code === 'NOT_ENOUGH_PLAYERS' && w.role === 'P')).toEqual([])
  })

  it('avvisa quando il budget non copre nemmeno gli slot alla puntata minima', () => {
    expect(
      coherenceWarnings({ teams: 10, slots, budget: 20, minBid: 1, available: listone }),
    ).toContainEqual({ code: 'BUDGET_BELOW_SLOTS', budget: 20, needed: 25 })
  })

  it('sul filo tace anche qui: 25 slot a 1 credito con 25 di budget si riempiono', () => {
    expect(
      coherenceWarnings({ teams: 10, slots, budget: 25, minBid: 1, available: listone }),
    ).toEqual([])
  })

  it('conta la puntata minima, non gli slot', () => {
    // 25 slot a 21 crediti sono 525: cinque più del budget predefinito.
    expect(
      coherenceWarnings({ teams: 10, slots, budget: 500, minBid: 21, available: listone }),
    ).toContainEqual({ code: 'BUDGET_BELOW_SLOTS', budget: 500, needed: 525 })
  })

  /**
   * Senza listone importato il controllo dei ruoli non ha dati, e tacere è
   * l’unica risposta onesta: «0 attaccanti disponibili» sarebbe un allarme falso
   * sulla schermata che meno se lo può permettere.
   */
  it('senza listone controlla solo il budget, e non inventa un ruolo vuoto', () => {
    const warnings = coherenceWarnings({
      teams: 10,
      slots,
      budget: 20,
      minBid: 1,
      available: null,
    })
    expect(warnings).toEqual([{ code: 'BUDGET_BELOW_SLOTS', budget: 20, needed: 25 }])
  })
})

