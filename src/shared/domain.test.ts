import { describe, expect, it } from 'vitest'
import { anomalyMessage } from './errors'
import {
  backupsToPrune,
  bonusIndex,
  canStartAuction,
  canTransition,
  chartBounds,
  checkPurchase,
  freeSlots,
  maxBid,
  coherenceWarnings,
  DEFAULT_SLOTS,
  frozen,
  hasHistory,
  LEAGUE_STATUSES,
  LEAGUE_TRANSITIONS,
  move,
  permutationOf,
  planCells,
  planTotals,
  rulesEditable,
  targetTotals,
  tierOneOverBudget,
  seasonWindow,
  cleanSheetRate,
  concededPerMatch,
  convenience,
  malusRate,
  MATCHDAYS,
  minutesPerMatch,
  normalizeName,
  reliability,
  rosterAnomalies,
  startShare,
  TEAM_COLORS,
  teamListEditable,
  totalSlots,
  type ClassicRole,
  type RosterAnomaly,
  type RosterState,
  type Violation,
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

/* T12. Gli obiettivi e i piani del documento 2 §4.6 e §4.7. */

describe('le intestazioni della board obiettivi, documento 2 §4.6', () => {
  const targets = [
    { roleClassic: 'A' as const, tier: 1, maxPrice: 120 },
    { roleClassic: 'A' as const, tier: 2, maxPrice: 60 },
    { roleClassic: 'D' as const, tier: 1, maxPrice: 40 },
    // Segnato con la stella e mai prezzato: esiste, e non aggiunge crediti.
    { roleClassic: 'D' as const, tier: null, maxPrice: null },
  ]

  it('conta gli obiettivi di ogni ruolo, fascia o non fascia', () => {
    const totals = targetTotals(targets, 500)
    expect(totals.A.count).toBe(2)
    expect(totals.D.count).toBe(2)
    expect(totals.P.count).toBe(0)
  })

  it('somma i prezzi massimi che ci sono, e tratta i mancanti come mancanti', () => {
    const totals = targetTotals(targets, 500)
    expect(totals.A.maxPriceTotal).toBe(180)
    // 40 e non 40 più qualcosa: l'obiettivo senza prezzo non ne inventa uno.
    expect(totals.D.maxPriceTotal).toBe(40)
  })

  it('pesa la somma sul budget', () => {
    expect(targetTotals(targets, 500).A.budgetShare).toBeCloseTo(0.36)
  })

  it('senza budget non finge una percentuale', () => {
    expect(targetTotals(targets, 0).A.budgetShare).toBeNull()
  })
})

/**
 * «È esattamente l'errore che si fa preparando l'asta»: otto prime scelte sono
 * sostenibili un reparto alla volta e insostenibili insieme. Per questo la somma
 * attraversa i ruoli invece di fermarsi dentro ciascuno.
 */
describe('l’avviso sulla fascia 1, documento 2 §4.6', () => {
  const budget = 500

  it('somma la fascia 1 di tutti i ruoli, non di uno solo', () => {
    const targets = [
      { roleClassic: 'A' as const, tier: 1, maxPrice: 200 },
      { roleClassic: 'C' as const, tier: 1, maxPrice: 200 },
      { roleClassic: 'D' as const, tier: 1, maxPrice: 150 },
    ]
    expect(tierOneOverBudget(targets, budget)).toEqual({ total: 550, budget: 500 })
  })

  it('guarda solo la fascia 1', () => {
    const targets = [
      { roleClassic: 'A' as const, tier: 1, maxPrice: 300 },
      { roleClassic: 'C' as const, tier: 2, maxPrice: 300 },
      { roleClassic: 'D' as const, tier: null, maxPrice: 300 },
    ]
    expect(tierOneOverBudget(targets, budget)).toBeNull()
  })

  it('sul filo tace: spendere esattamente il budget non è sforare', () => {
    const targets = [{ roleClassic: 'A' as const, tier: 1, maxPrice: 500 }]
    expect(tierOneOverBudget(targets, budget)).toBeNull()
  })

  it('senza obiettivi non ha niente da dire', () => {
    expect(tierOneOverBudget([], budget)).toBeNull()
  })
})

describe('la barra del piano, documento 2 §4.7', () => {
  const slots = { P: 1, D: 2, C: 2, A: 1 }

  it('dice speso, residuo e media per slot rimanente', () => {
    const totals = planTotals(
      [
        { slotRole: 'A' as const, estPrice: 200 },
        { slotRole: 'D' as const, estPrice: 100 },
      ],
      slots,
      500,
    )
    expect(totals.spent).toBe(300)
    expect(totals.remaining).toBe(200)
    expect(totals.slotsFilled).toBe(2)
    expect(totals.slotsLeft).toBe(4)
    expect(totals.perSlot).toBe(50)
  })

  /** La stessa guardia che l'invariante 5 mette sulla puntata massima. */
  it('a rosa piena non divide per zero: la media non esiste', () => {
    const full = [
      { slotRole: 'P' as const, estPrice: 10 },
      { slotRole: 'D' as const, estPrice: 10 },
      { slotRole: 'D' as const, estPrice: 10 },
      { slotRole: 'C' as const, estPrice: 10 },
      { slotRole: 'C' as const, estPrice: 10 },
      { slotRole: 'A' as const, estPrice: 10 },
    ]
    expect(planTotals(full, slots, 500).perSlot).toBeNull()
  })

  it('un piano vuoto ha tutto il budget su tutti gli slot', () => {
    const totals = planTotals([], slots, 500)
    expect(totals.slotsLeft).toBe(6)
    expect(totals.perSlot).toBeCloseTo(500 / 6)
  })

  /**
   * Il caso che nasce da solo: l'invariante 16 lascia modificare gli slot in
   * `pre_auction`, quindi un piano da otto difensori sopravvive a chi porta i
   * difensori a sei. I due di troppo non occupano nessuna casella, e non devono
   * occuparne nemmeno nel conto — altrimenti la barra dichiara piena una rosa
   * che la griglia non riesce a disegnare.
   */
  it('non conta come riempito chi è oltre gli slot del suo ruolo', () => {
    const tooMany = [
      { slotRole: 'D' as const, estPrice: 10 },
      { slotRole: 'D' as const, estPrice: 10 },
      { slotRole: 'D' as const, estPrice: 10 },
    ]
    const totals = planTotals(tooMany, slots, 500)
    expect(totals.slotsFilled).toBe(2)
    expect(totals.slotsLeft).toBe(4)
    // Speso resta quello vero: i crediti del terzo difensore sono impegnati lo
    // stesso, ed è proprio quello che rende il piano da sistemare.
    expect(totals.spent).toBe(30)
  })
})

/**
 * T13. La tabella del documento 6 §4, riga per riga.
 *
 * Scritti prima del servizio, che è l'ordine che il §7 impone: «le funzioni pure
 * sono la definizione di cosa è corretto, e scrivere il servizio prima significa
 * scoprire le regole mentre si scrive il codice che le applica».
 *
 * Sono anche i test che il criterio di completamento di T13 nomina — «la puntata
 * massima a rosa quasi completa e la regola di completabilità» — e gli unici in
 * tutta la suite che riguardano la sera per cui l'app esiste.
 */
describe('la puntata massima, invariante 5', () => {
  /** Una rosa da 25 slot, con quanti ne ha già presi e quanti crediti restano. */
  const roster = (credits: number, filled: Partial<Record<ClassicRole, number>>): RosterState => ({
    credits,
    slots: DEFAULT_SLOTS,
    filled: { P: 0, D: 0, C: 0, A: 0, ...filled },
  })

  it('con un solo slot libero vale tutti i crediti', () => {
    // 24 slot su 25 occupati: non deve tenere niente da parte.
    expect(maxBid(roster(40, { P: 3, D: 8, C: 8, A: 5 }), 1)).toBe(40)
  })

  it('con cinque slot liberi tiene da parte i quattro che restano', () => {
    expect(maxBid(roster(40, { P: 3, D: 8, C: 6, A: 3 }), 1)).toBe(36)
  })

  /**
   * La riga in grassetto del documento 6 §4, e la ragione per cui la guardia
   * esiste: senza, la formula tornerebbe `crediti + min_bid` — quaranta crediti
   * diventerebbero quarantuno proprio sulla squadra che non può più comprare.
   */
  it('a rosa completa vale zero, non i crediti più la puntata minima', () => {
    expect(maxBid(roster(40, { P: 3, D: 8, C: 8, A: 6 }), 1)).toBe(0)
  })

  it('vale zero anche con una rosa più che completa', () => {
    // Non capita, ma se capitasse `free` sarebbe negativo e la formula
    // restituirebbe più dei crediti disponibili.
    expect(maxBid(roster(40, { P: 4, D: 8, C: 8, A: 6 }), 1)).toBe(0)
  })

  it('conta la puntata minima della lega, non uno', () => {
    // 5 slot liberi a puntata minima 3: 40 − 4×3 = 28.
    expect(maxBid(roster(40, { P: 3, D: 8, C: 6, A: 3 }), 3)).toBe(28)
  })

  it('non promette crediti che non ci sono', () => {
    expect(maxBid(roster(0, { P: 3, D: 8, C: 8, A: 5 }), 1)).toBe(0)
  })

  /**
   * Il pavimento a zero, e il caso che ci arriva davvero.
   *
   * Durante l'asta non capita: l'invariante 4 rifiuta l'acquisto che ci porta. Ma
   * la revisione ci arriva, perché l'invariante 11 lascia passare proprio quelle
   * violazioni come segnalazioni — e una puntata massima negativa a schermo non
   * vuol dire niente.
   */
  it('a crediti insufficienti per gli slot liberi resta a zero, non va sotto', () => {
    // 5 crediti, 10 slot liberi, puntata minima 1: la formula darebbe −4.
    expect(maxBid(roster(5, { P: 3, D: 8, C: 4, A: 0 }), 1)).toBe(0)
  })
})

/**
 * L'invariante 8. Non è aritmetica su una rosa ma sulla lega, e sta qui per la
 * stessa ragione: il servizio che apre l'asta deve poterla chiedere, e un test
 * su Node deve poterla verificare.
 */
describe('quando si può aprire l’asta, invariante 8', () => {
  it('vuole almeno due squadre', () => {
    expect(canStartAuction({ teams: 2, slots: DEFAULT_SLOTS })).toBe(true)
    expect(canStartAuction({ teams: 1, slots: DEFAULT_SLOTS })).toBe(false)
    expect(canStartAuction({ teams: 0, slots: DEFAULT_SLOTS })).toBe(false)
  })

  it('vuole degli slot: una rosa di soli zeri non ha niente da battere', () => {
    expect(canStartAuction({ teams: 10, slots: { P: 0, D: 0, C: 0, A: 0 } })).toBe(false)
    expect(canStartAuction({ teams: 10, slots: { P: 1, D: 0, C: 0, A: 0 } })).toBe(true)
  })
})

describe('gli slot liberi', () => {
  it('somma i quattro ruoli', () => {
    expect(
      freeSlots({ credits: 0, slots: DEFAULT_SLOTS, filled: { P: 1, D: 2, C: 0, A: 0 } }),
    ).toBe(22)
  })

  it('a rosa completa è zero', () => {
    expect(freeSlots({ credits: 0, slots: DEFAULT_SLOTS, filled: DEFAULT_SLOTS })).toBe(0)
  })
})

describe('il controllo di un acquisto, documento 6 §4', () => {
  const roster = (credits: number, filled: Partial<Record<ClassicRole, number>>): RosterState => ({
    credits,
    slots: DEFAULT_SLOTS,
    filled: { P: 0, D: 0, C: 0, A: 0, ...filled },
  })
  const codes = (v: Violation[]): string[] => v.map((x) => x.code)

  it('lascia passare un acquisto sostenibile', () => {
    expect(checkPurchase(roster(500, {}), 'A', 47, 1, 'blocking')).toEqual([])
  })

  /**
   * Le due righe del documento 6 §4, con i suoi numeri: «20 crediti, 15 slot
   * liberi, prezzo 19 → violazione di completabilità» e «prezzo 5 → nessuna
   * violazione».
   *
   * Il fissato è costruito per avere esattamente quei quindici slot liberi, e non
   * per assomigliarci: la completabilità dell'invariante 4 e la puntata massima
   * della 5 sono la stessa aritmetica, 20 − 14×1 = 6, e quel 6 esiste solo con
   * quel numero di slot. Un commento che cita numeri diversi da quelli eseguiti è
   * una specifica che non è più tale.
   */
  it('rifiuta un prezzo che lascerebbe la rosa incompletabile', () => {
    const r = roster(20, { P: 3, D: 5, C: 2, A: 0 })
    expect(freeSlots(r)).toBe(15)
    expect(maxBid(r, 1)).toBe(6)
    expect(codes(checkPurchase(r, 'A', 19, 1, 'blocking'))).toEqual(['EXCEEDS_MAX_BID'])
  })

  it('e lascia passare il prezzo 5 della riga accanto', () => {
    expect(checkPurchase(roster(20, { P: 3, D: 5, C: 2, A: 0 }), 'A', 5, 1, 'blocking')).toEqual([])
  })

  // Cinque slot liberi invece di quindici: la massima sale a 16, ed è il confine
  // che il servizio ha poi confermato sul database vero.
  it('sul filo passa: la puntata massima esatta è ammessa', () => {
    const r = roster(20, { P: 3, D: 8, C: 8, A: 1 })
    expect(freeSlots(r)).toBe(5)
    expect(maxBid(r, 1)).toBe(16)
    expect(checkPurchase(r, 'A', 16, 1, 'blocking')).toEqual([])
    expect(codes(checkPurchase(r, 'A', 17, 1, 'blocking'))).toEqual(['EXCEEDS_MAX_BID'])
  })

  it('rifiuta un ruolo con gli slot pieni', () => {
    expect(codes(checkPurchase(roster(500, { A: 6 }), 'A', 10, 1, 'blocking'))).toContain(
      'ROLE_SLOTS_FULL',
    )
  })

  it('rifiuta un prezzo sotto la puntata minima', () => {
    expect(codes(checkPurchase(roster(500, {}), 'A', 0, 1, 'blocking'))).toContain('BELOW_MIN_BID')
  })

  /**
   * Prezzo oltre i crediti: due righe del documento 2 §7 si sovrappongono, e ne
   * esce una sola. «Real Fanta ha 218 crediti» dice la cosa più grossa; «può
   * arrivare a 205» sarebbe vero e più preciso, e messo accanto all'altro
   * sembrerebbe che il problema siano tredici crediti invece di ottanta.
   */
  it('dice i crediti quando il prezzo li supera, e non anche la puntata massima', () => {
    expect(codes(checkPurchase(roster(100, { A: 1 }), 'A', 300, 1, 'blocking'))).toEqual([
      'INSUFFICIENT_CREDITS',
    ])
  })

  it('porta i numeri che il messaggio dovrà scrivere', () => {
    const [violation] = checkPurchase(roster(20, { P: 3, D: 5, C: 2, A: 0 }), 'A', 19, 1, 'blocking')
    // «può arrivare a 6: deve tenere 14 crediti per gli slot rimasti»
    expect(violation.detail).toEqual({ max: 6, keep: 14 })
  })

  /**
   * L'ultima riga della tabella del §4, e quella che protegge l'invariante 11:
   * in revisione le violazioni di merito si segnalano e non bloccano. Deve essere
   * la stessa funzione con un parametro diverso — una seconda implementazione
   * userebbe la stessa aritmetica il primo giorno e un'altra il secondo.
   */
  it('in revisione le stesse violazioni ci sono ma non bloccano', () => {
    const r = roster(20, { P: 3, D: 5, C: 2, A: 0 })
    const blocking = checkPurchase(r, 'A', 19, 1, 'blocking')
    const advisory = checkPurchase(r, 'A', 19, 1, 'advisory')
    expect(codes(advisory)).toEqual(codes(blocking))
    expect(advisory.every((v) => v.blocking)).toBe(false)
    expect(blocking.every((v) => v.blocking)).toBe(true)
  })

  /**
   * L'invariante 11 declassa la 2, la 3 e la 4 — non la 1, la 6 e la 7, che sono
   * errori strutturali. La puntata minima non è fra quelle che declassa: un
   * prezzo sotto il minimo resta un errore di merito, e in revisione si segnala
   * come gli altri.
   */
  it('anche la puntata minima si declassa in revisione', () => {
    expect(checkPurchase(roster(500, {}), 'A', 0, 1, 'advisory')[0].blocking).toBe(false)
  })

  it('accumula più violazioni insieme', () => {
    // Ruolo pieno e prezzo sotto il minimo nello stesso acquisto.
    expect(codes(checkPurchase(roster(500, { A: 6 }), 'A', 0, 1, 'blocking')).sort()).toEqual(
      ['BELOW_MIN_BID', 'ROLE_SLOTS_FULL'].sort(),
    )
  })
})

describe('le anomalie di una rosa in revisione, documento 2 §4.10', () => {
  const roster = (credits: number, filled: Partial<Record<ClassicRole, number>>): RosterState => ({
    credits,
    slots: DEFAULT_SLOTS,
    filled: { P: 0, D: 0, C: 0, A: 0, ...filled },
  })
  const codes = (a: RosterAnomaly[]): string[] => a.map((x) => x.code)

  it('una rosa completa e in pari non ha niente da segnalare', () => {
    expect(rosterAnomalies(roster(0, DEFAULT_SLOTS), 1)).toEqual([])
  })

  it('dice di quanto una squadra ha sforato', () => {
    const [anomaly] = rosterAnomalies(roster(-4, DEFAULT_SLOTS), 1)
    expect(anomaly).toEqual({ code: 'OVER_BUDGET', detail: { n: 4 } })
    expect(anomalyMessage(anomaly)).toBe('sforato di 4 crediti')
  })

  /**
   * La stessa sovrapposizione che `checkPurchase` risolve fra la 2 e la 4: chi
   * ha sforato non può nemmeno completare, e le due righe insieme farebbero
   * sembrare due problemi quello che è uno.
   */
  it('chi ha sforato non si sente dire anche che non può completare', () => {
    // Cinque slot liberi e crediti sotto zero: senza l'esclusione parlerebbero
    // entrambe, perché a −4 crediti la rosa è incompletabile per definizione.
    const r = roster(-4, { P: 3, D: 8, C: 8, A: 1 })
    expect(freeSlots(r)).toBe(5)
    expect(codes(rosterAnomalies(r, 1))).toEqual(['OVER_BUDGET', 'ROLE_MISSING'])
  })

  it('segnala la rosa che non si riempie più alla puntata minima', () => {
    const r = roster(3, { P: 3, D: 8, C: 8, A: 1 })
    expect(freeSlots(r)).toBe(5)
    // Due righe e non una: i cinque slot liberi sono cinque attaccanti che
    // mancano, e §4.10 le vuole entrambe — «tutte vengono mostrate».
    expect(rosterAnomalies(r, 1)).toEqual([
      { code: 'NOT_COMPLETABLE', detail: { credits: 3, slots: 5 } },
      { code: 'ROLE_MISSING', role: 'A', detail: { n: 5 } },
    ])
  })

  it('e non la segnala a chi ha esattamente i crediti che servono', () => {
    // 5 crediti per 5 slot alla puntata minima di 1: sul filo, e il filo passa.
    expect(codes(rosterAnomalies(roster(5, { P: 3, D: 8, C: 8, A: 1 }), 1))).toEqual([
      'ROLE_MISSING',
    ])
    expect(codes(rosterAnomalies(roster(4, { P: 3, D: 8, C: 8, A: 1 }), 1))).toEqual([
      'NOT_COMPLETABLE',
      'ROLE_MISSING',
    ])
  })

  /**
   * Il pannello disegnato nel §4.10, parola per parola: «9 difensori su 8» e
   * sotto «1 portiere mancante». Il fissato è costruito per dare esattamente
   * quelle due righe in quell'ordine, che è il motivo per cui le due passate
   * sono due e non una.
   *
   * Zero slot liberi in totale — il difensore di troppo pareggia il portiere che
   * manca — quindi la completabilità tace, e resta un caso in cui l'unica cosa
   * che parla è il conteggio per ruolo.
   */
  it('con le parole del pannello disegnato nel documento', () => {
    const r = roster(0, { P: 2, D: 9, C: 8, A: 6 })
    expect(freeSlots(r)).toBe(0)
    expect(codes(rosterAnomalies(r, 1))).toEqual(['ROLE_OVER', 'ROLE_MISSING'])
    expect(rosterAnomalies(r, 1).map(anomalyMessage)).toEqual([
      '9 difensori su 8',
      '1 portiere mancante',
    ])
  })

  /**
   * Il CLAUDE.md: «Un messaggio che conta sa contare fino a uno e a zero.»
   * Quattro codici, quattro rami singolari, tutti su una schermata che ne mostra
   * decine insieme.
   */
  it('sa contare fino a uno', () => {
    expect(anomalyMessage({ code: 'OVER_BUDGET', detail: { n: 1 } })).toBe('sforato di 1 credito')
    expect(anomalyMessage({ code: 'ROLE_MISSING', role: 'P', detail: { n: 1 } })).toBe(
      '1 portiere mancante',
    )
    expect(anomalyMessage({ code: 'ROLE_MISSING', role: 'P', detail: { n: 2 } })).toBe(
      '2 portieri mancanti',
    )
    expect(anomalyMessage({ code: 'ROLE_OVER', role: 'D', detail: { have: 1, slots: 0 } })).toBe(
      '1 difensore su 0',
    )
    expect(anomalyMessage({ code: 'NOT_COMPLETABLE', detail: { credits: 1, slots: 2 } })).toBe(
      '1 credito per 2 slot da riempire',
    )
  })

  /** «Tutte vengono mostrate»: nessuna soglia, nessun troncamento. */
  it('elenca insieme tutti i ruoli che non tornano', () => {
    // 7 slot liberi in totale e 7 crediti: la completabilità tace e restano
    // soltanto i quattro conteggi per ruolo.
    const r = roster(7, { P: 0, D: 9, C: 9, A: 0 })
    expect(freeSlots(r)).toBe(7)
    expect(codes(rosterAnomalies(r, 1))).toEqual([
      'ROLE_OVER',
      'ROLE_OVER',
      'ROLE_MISSING',
      'ROLE_MISSING',
    ])
  })
})

describe('la griglia del piano, documento 2 §4.7', () => {
  const slots = { P: 1, D: 2, C: 2, A: 1 }

  it('riempie le caselle nell’ordine dato e conta quelle vuote', () => {
    const cells = planCells([{ slotRole: 'D' as const, estPrice: 30 }], slots)
    expect(cells.D.filled).toHaveLength(1)
    expect(cells.D.empty).toBe(1)
    expect(cells.P.empty).toBe(1)
    expect(cells.A.overflow).toEqual([])
  })

  it('mette da parte chi non ha più una casella, invece di lasciarlo cadere', () => {
    const cells = planCells(
      [
        { slotRole: 'D' as const, estPrice: 30 },
        { slotRole: 'D' as const, estPrice: 20 },
        { slotRole: 'D' as const, estPrice: 10 },
      ],
      slots,
    )
    expect(cells.D.filled).toHaveLength(2)
    expect(cells.D.empty).toBe(0)
    expect(cells.D.overflow).toEqual([{ slotRole: 'D', estPrice: 10 }])
  })

  it('con zero slot per un ruolo, tutto quel ruolo è di troppo', () => {
    const cells = planCells([{ slotRole: 'P' as const, estPrice: 5 }], { ...slots, P: 0 })
    expect(cells.P.filled).toEqual([])
    expect(cells.P.empty).toBe(0)
    expect(cells.P.overflow).toHaveLength(1)
  })
})


