import ExcelJS from 'exceljs'
import { flattenCell, type CellValue } from '@shared/sheet'

/**
 * The app's half of reading an .xlsx: open the workbook, hand back a grid.
 *
 * Deliberately this small. Everything that decides anything — where the header
 * row is, which column is which, what makes a file unreadable — lives in
 * `@shared/sheet` and is shared with the offline pipeline, which owns the same
 * fifteen lines against the same library on its own side of the repo. The
 * duplication stops at the adapter, and the adapter has no judgement in it: two
 * copies of `findSheet` could disagree about a listone, two copies of this
 * cannot.
 */
export async function readGrid(file: string): Promise<CellValue[][]> {
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
