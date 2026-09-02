import { CLASSIC_ROLES, ROLE_LABELS } from './domain'
import type { CellValue } from './sheet'
import { snapshotReport, type SnapshotFile } from './snapshot'

/**
 * Il foglio del documento 2 §4.11: «un foglio leggibile con una scheda per
 * squadra e una riepilogativa».
 *
 * Qui c'è tutto ciò che **decide** qualcosa — quali colonne, in che ordine, come
 * si chiamano i fogli — e niente di exceljs. È la stessa divisione che il
 * lettore XLSX dichiara dalla sua parte: «l'adattatore non ha giudizio». Il
 * guadagno è che il contenuto del file che finisce nelle mani degli amici si
 * prova sotto Vitest, senza aprire una cartella di lavoro.
 *
 * «Il XLSX è per gli amici, il JSON è per l'app»: da cui i nomi per esteso, i
 * prezzi come numeri e non come testo, e nessuna colonna che serva soltanto a
 * un programma.
 */

export type WorkbookSheet = { name: string; rows: CellValue[][] }

/** Excel non accetta questi caratteri in un nome di foglio, e non lo spiega. */
const FORBIDDEN = /[:\\/?*[\]]/g

/** Il limite di Excel. Un nome più lungo non viene troncato: il file non si apre. */
const MAX_NAME = 31

/**
 * Il nome di un foglio a partire dal nome di una squadra.
 *
 * Tre cose che una squadra può fare e un foglio no: contenere `/` — «Real/Fanta»
 * è un nome plausibile e rompe il file senza spiegare perché — superare i 31
 * caratteri, e ripetersi. L'ultima non è teorica: i nomi delle squadre sono
 * unici dentro una lega (`UNIQUE (league_id, name)`), ma due nomi lunghi che
 * differiscono dopo il trentunesimo carattere diventano lo stesso foglio, e due
 * fogli omonimi sono un file che Excel rifiuta di aprire.
 *
 * `taken` sono i nomi già usati, confrontati senza distinguere le maiuscole
 * perché è così che Excel li considera uguali.
 */
export function sheetName(raw: string, taken: readonly string[]): string {
  const cleaned = raw.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '')
  const base = (cleaned === '' ? 'Squadra' : cleaned).slice(0, MAX_NAME)

  const used = new Set(taken.map((t) => t.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base

  // «Nome (2)», e il nome si accorcia quanto basta a far stare il suffisso.
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`
    const candidate = base.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return base.slice(0, MAX_NAME - 8) + ` (${taken.length + 1})`
}

/**
 * I fogli del file, riepilogo per primo.
 *
 * Il riepilogo prima delle schede perché è quello che si guarda per primo, e
 * perché una cartella di lavoro si apre sul primo foglio: chi riceve il file
 * vede il quadro e poi decide quale rosa aprire.
 */
export function workbookSheets(file: SnapshotFile): WorkbookSheet[] {
  const report = snapshotReport(file)
  const byTeam = new Map<string, SnapshotFile['purchases']>()
  for (const bought of file.purchases) {
    byTeam.set(bought.teamUuid, [...(byTeam.get(bought.teamUuid) ?? []), bought])
  }

  /**
   * `allenatore` e non `giocatore`: è come si chiama quel campo nell'app, e
   * accanto c'è `giocatori`, che sono i calciatori. Le due colonne erano il
   * singolare e il plurale della stessa parola con due significati diversi, e
   * nelle schede delle squadre `giocatore` torna a essere il calciatore — la
   * stessa parola per due cose in due fogli della stessa cartella.
   *
   * `spesa` davanti ai reparti per la stessa ragione: le quattro colonne finali
   * sono crediti, ma chi legge da sinistra ha appena incontrato un conteggio
   * («giocatori») e arriva a «portieri 32» già in modalità «conta». Nel
   * resoconto quel contesto lo dà l'ambra, qui non c'è.
   */
  const summary: CellValue[][] = [
    [
      'squadra',
      'allenatore',
      'giocatori',
      'spesa',
      'in mano',
      ...CLASSIC_ROLES.map((r) => `spesa ${ROLE_LABELS[r]}`),
    ],
    ...report.teams.map((team) => [
      team.name,
      team.manager,
      team.players,
      team.spent,
      team.left,
      ...CLASSIC_ROLES.map((r) => team.byRole[r].spent),
    ]),
  ]

  const sheets: WorkbookSheet[] = [{ name: 'Riepilogo', rows: summary }]

  for (const team of report.teams) {
    const bought = byTeam.get(team.uuid) ?? []
    /**
     * Per ruolo e poi per prezzo, non nell'ordine in cui sono stati comprati.
     *
     * Una rosa si legge per reparto: l'ordine dell'asta è l'ordine della serata
     * e nel foglio non dice più niente a nessuno. `CLASSIC_ROLES` dà l'ordine
     * P, D, C, A, che è quello di ogni altra tabella dell'app.
     */
    const rows = [...bought].sort(
      (a, b) =>
        CLASSIC_ROLES.indexOf(a.slotRole) - CLASSIC_ROLES.indexOf(b.slotRole) ||
        b.price - a.price ||
        (a.playerName < b.playerName ? -1 : a.playerName > b.playerName ? 1 : 0),
    )

    sheets.push({
      name: sheetName(
        team.name,
        sheets.map((s) => s.name),
      ),
      rows: [
        ['ruolo', 'giocatore', 'club', 'prezzo'],
        ...rows.map((p) => [p.slotRole, p.playerName, p.playerTeam, p.price]),
        // La riga dei totali, staccata da una vuota: sommata a mano da chi apre
        // il file sarebbe la prima cosa che qualcuno sbaglia.
        [],
        ['totale', null, null, team.spent],
        ['in mano', null, null, team.left],
      ],
    })
  }

  return sheets
}
