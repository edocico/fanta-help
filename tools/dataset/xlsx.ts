import ExcelJS from 'exceljs'

/**
 * Reading an .xlsx the way document 4 §6 requires.
 *
 * Two rules, both there because Fantacalcio.it re-paginates the file between
 * seasons: the header row is *found*, never assumed to be the first, and columns
 * are mapped by header name, never by position. A parser that trusts position
 * does not fail when a column is inserted — it silently reads the wrong one, and
 * every quotazione is off by one for a whole auction.
 */

export type CellValue = string | number | boolean | Date | null

export interface Sheet {
  /** Header texts exactly as the file spells them, in column order. */
  headers: string[]
  /** 1-based index of the header row, so errors can point at it. */
  headerRow: number
  /** One record per data row, keyed by `headerKey(header)`. */
  rows: Array<Record<string, CellValue>>
}

/**
 * The form headers are compared in. Case and stray spacing vary between files;
 * dots do not, so `Qt.A` and `Qt.I` stay distinguishable.
 */
export function headerKey(header: string): string {
  return header.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Cells arrive as formulas, rich text or hyperlinks. Flatten them to a value. */
function toPrimitive(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    if ('result' in value) return toPrimitive(value.result as ExcelJS.CellValue)
    if ('richText' in value) return value.richText.map((run) => run.text).join('')
    if ('text' in value) return String(value.text)
    if ('error' in value) return null
    return null
  }
  return value as CellValue
}

/** How far down to look before giving up on finding the header row. */
const HEADER_SEARCH_DEPTH = 20

/**
 * Reads the first worksheet, keyed by header name.
 *
 * `markers` are the headers that identify the header row — document 4 §6 uses
 * `Nome` and `Squadra`. They are matched through `headerKey`, so case and
 * spacing do not matter.
 */
export async function readSheet(file: string, markers: string[]): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`${file}: il file non contiene nessun foglio`)

  const wanted = markers.map(headerKey)
  const depth = Math.min(HEADER_SEARCH_DEPTH, sheet.rowCount)
  const seen: string[] = []

  for (let r = 1; r <= depth; r++) {
    const texts: string[] = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      const value = toPrimitive(sheet.getRow(r).getCell(c).value)
      texts.push(value === null ? '' : String(value).trim())
    }
    const keys = texts.map(headerKey)
    seen.push(texts.filter(Boolean).join(' | '))

    if (!wanted.every((marker) => keys.includes(marker))) continue

    // Trailing empties are formatting, not columns. Cut at the last named one.
    const width = keys.reduce((last, key, i) => (key ? i + 1 : last), 0)
    const headers = texts.slice(0, width)
    const columns = keys.slice(0, width)

    const duplicates = columns.filter((key, i) => key !== '' && columns.indexOf(key) !== i)
    if (duplicates.length > 0) {
      throw new Error(
        `${file}: la riga di intestazione ${r} ripete la colonna "${duplicates[0]}". ` +
          `Mappare per nome è impossibile finché il nome non è unico.`,
      )
    }

    const rows: Array<Record<string, CellValue>> = []
    for (let i = r + 1; i <= sheet.rowCount; i++) {
      const record: Record<string, CellValue> = {}
      let empty = true
      for (let c = 1; c <= width; c++) {
        const key = columns[c - 1]
        if (!key) continue
        const value = toPrimitive(sheet.getRow(i).getCell(c).value)
        record[key] = typeof value === 'string' ? value.trim() : value
        if (record[key] !== null && record[key] !== '') empty = false
      }
      if (!empty) rows.push(record)
    }

    return { headers, headerRow: r, rows }
  }

  throw new Error(
    `${file}: nessuna riga fra le prime ${depth} contiene tutte le colonne ${markers.join(', ')}.\n` +
      `Righe lette:\n${seen.map((row, i) => `  ${i + 1}: ${row || '(vuota)'}`).join('\n')}`,
  )
}

/** Reads a cell that must be a whole number, and says which row failed if not. */
export function requireInt(row: Record<string, CellValue>, key: string, at: number): number {
  const value = row[headerKey(key)]
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isInteger(parsed)) {
    throw new Error(`riga ${at}: la colonna "${key}" vale "${String(value)}", che non è un intero`)
  }
  return parsed
}

/** Reads a cell that must be non-empty text, and says which row failed if not. */
export function requireText(row: Record<string, CellValue>, key: string, at: number): string {
  const value = row[headerKey(key)]
  const text = value === null || value === undefined ? '' : String(value).trim()
  if (text === '') throw new Error(`riga ${at}: la colonna "${key}" è vuota`)
  return text
}
