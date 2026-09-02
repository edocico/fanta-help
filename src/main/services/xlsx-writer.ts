import ExcelJS from 'exceljs'
import type { CellValue } from '@shared/sheet'

/**
 * L'altra metà di `readGrid`: prende dei fogli e scrive una cartella di lavoro.
 *
 * Deliberatamente senza giudizio, come il lettore accanto. Quali colonne, in
 * che ordine, come si chiamano i fogli e cosa fare di un nome troppo lungo lo
 * decide `@shared/workbook`, che si prova sotto Vitest: qui restano l'apertura
 * del file e la larghezza delle colonne, cioè le uniche due cose che senza
 * exceljs non si possono fare.
 *
 * `exceljs` sta in `dependencies` e non fra le dev, ed è una riga della tabella
 * delle trappole del `CLAUDE.md` scritta dopo averla presa: il main non viene
 * impacchettato da Vite, quindi si carica da `node_modules` a runtime, ed
 * electron-builder pota le devDependencies. Da lì funzionerebbe in sviluppo e
 * morirebbe nel pacchetto.
 */
export async function writeGrid(
  file: string,
  sheets: { name: string; rows: CellValue[][] }[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Fanta Help'

  for (const { name, rows } of sheets) {
    const sheet = workbook.addWorksheet(name)
    for (const row of rows) sheet.addRow(row)

    // La prima riga è sempre l'intestazione, e resta visibile scorrendo: una
    // rosa da venticinque righe esce dallo schermo, e sotto senza intestazione
    // le colonne diventano quattro numeri senza nome.
    if (rows.length > 0) {
      sheet.getRow(1).font = { bold: true }
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
    }

    /**
     * Le colonne larghe quanto il loro contenuto.
     *
     * Senza, ogni colonna esce a undici caratteri e i nomi dei giocatori si
     * leggono come `Marti…`: un file che si apre e non si legge è peggio di uno
     * che non si apre, perché sembra a posto. Il tetto a quaranta evita che una
     * nota lunga faccia una colonna che non entra nello schermo.
     */
    const widths: number[] = []
    for (const row of rows) {
      row.forEach((cell, i) => {
        const length = cell === null || cell === undefined ? 0 : String(cell).length
        widths[i] = Math.max(widths[i] ?? 0, length)
      })
    }
    widths.forEach((width, i) => {
      sheet.getColumn(i + 1).width = Math.min(Math.max(width + 2, 8), 40)
    })
  }

  await workbook.xlsx.writeFile(file)
}
