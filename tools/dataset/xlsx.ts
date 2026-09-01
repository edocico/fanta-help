import ExcelJS from 'exceljs'
import { findSheet, flattenCell, type CellValue, type Sheet } from '@shared/sheet'

/**
 * The listone reader of the pipeline: `exceljs`, and nothing else.
 *
 * Everything that can be wrong with the *shape* of a sheet — the header row is
 * found rather than assumed, columns are mapped by name rather than by position,
 * a repeated column name is refused — lives in `@shared/sheet` as a pure function
 * on a grid of cells. It has to: T8 imports the same file from inside the app,
 * and two implementations of that logic would drift with nothing to notice.
 *
 * What is left here is the adapter, and the pipeline's policy on failure: print
 * it and stop. The app does something else with the very same outcome.
 */

export { headerKey, requireInt, requireText } from '@shared/sheet'
export type { CellValue, Sheet } from '@shared/sheet'

/** The whole first worksheet as a rectangular grid, formulas and rich text flattened. */
async function readGrid(file: string): Promise<CellValue[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`${file}: il file non contiene nessun foglio`)

  const grid: CellValue[][] = []
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row: CellValue[] = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      row.push(flattenCell(sheet.getRow(r).getCell(c).value))
    }
    grid.push(row)
  }
  return grid
}

/**
 * Reads the first worksheet, keyed by header name.
 *
 * `markers` are the headers that identify the header row — document 4 §6 uses
 * `Nome` and `Squadra`.
 */
export async function readSheet(file: string, markers: string[]): Promise<Sheet> {
  const found = findSheet(await readGrid(file), markers)
  if (found.found) return found.sheet

  if (found.reason === 'duplicate-column') {
    throw new Error(
      `${file}: la riga di intestazione ${found.headerRow} ripete la colonna ` +
        `"${found.column}". Mappare per nome è impossibile finché il nome non è unico.`,
    )
  }

  throw new Error(
    `${file}: nessuna riga fra le prime ${found.depth} contiene tutte le colonne ` +
      `${markers.join(', ')}.\n` +
      `Righe lette:\n${found.seen.map((row, i) => `  ${i + 1}: ${row || '(vuota)'}`).join('\n')}`,
  )
}
