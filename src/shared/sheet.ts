/**
 * Reading a spreadsheet the way document 4 §6 requires, minus the spreadsheet.
 *
 * Everything here works on a plain grid of cells, so the part that actually has
 * to be right — finding the header row instead of assuming it, mapping columns by
 * name instead of by position — is a pure function two callers share: the offline
 * pipeline and the in-app XLSX import of T8. Before that split this logic lived
 * next to `exceljs`, which meant it could not be tested at all: Vitest runs on
 * Node and the tests fabricated `Sheet` objects by hand, so the header search
 * that document 4 §6 asks for by name was the one part nothing exercised.
 *
 * Nothing here imports a spreadsheet library, Node or the DOM: rule 3. Turning a
 * workbook into a grid is a dozen lines and belongs to whoever owns the library.
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

/**
 * Cells arrive as formulas, rich text or hyperlinks, depending on how the sheet
 * was authored. Flatten them to a value.
 *
 * Typed as `unknown` rather than against a library's cell union on purpose: the
 * checks below are structural, so this stays usable by any reader and testable
 * without one.
 */
export function flattenCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>
    if ('result' in cell) return flattenCell(cell.result)
    if ('richText' in cell) {
      const runs = cell.richText as Array<{ text: string }>
      return runs.map((run) => run.text).join('')
    }
    if ('text' in cell) return String(cell.text)
    // An error cell (#REF!, #N/A) is not a value: reading it as text would put
    // the spreadsheet's own complaint into the database as a player's name.
    if ('error' in cell) return null
    return null
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return null
}

/** How far down to look before giving up on finding the header row. */
export const HEADER_SEARCH_DEPTH = 20

export type SheetSearch =
  | { found: true; sheet: Sheet }
  /** No row among the first `depth` carried every marker. `seen` is what was read. */
  | { found: false; reason: 'no-header'; depth: number; seen: string[] }
  /** Mapping by name is impossible while a name is not unique. */
  | { found: false; reason: 'duplicate-column'; headerRow: number; column: string }

/**
 * Finds the header row and keys every data row by header name.
 *
 * `markers` are the headers that identify the header row — document 4 §6 uses
 * `Nome` and `Squadra`. They are matched through `headerKey`, so case and spacing
 * do not matter.
 *
 * Returns rather than throws, because the two callers want opposite things from
 * a failure: the pipeline prints it and exits, the app turns it into a code from
 * shared/errors.ts. A thrown Error would reach the renderer as UNKNOWN.
 */
export function findSheet(
  grid: readonly (readonly CellValue[])[],
  markers: readonly string[],
  searchDepth: number = HEADER_SEARCH_DEPTH,
): SheetSearch {
  const wanted = markers.map(headerKey)
  const depth = Math.min(searchDepth, grid.length)
  const seen: string[] = []

  for (let r = 0; r < depth; r++) {
    const texts = (grid[r] ?? []).map((value) => (value === null ? '' : String(value).trim()))
    const keys = texts.map(headerKey)
    seen.push(texts.filter(Boolean).join(' | '))

    if (!wanted.every((marker) => keys.includes(marker))) continue

    // Trailing empties are formatting, not columns. Cut at the last named one.
    const width = keys.reduce((last, key, i) => (key ? i + 1 : last), 0)
    const headers = texts.slice(0, width)
    const columns = keys.slice(0, width)

    const duplicate = columns.find((key, i) => key !== '' && columns.indexOf(key) !== i)
    if (duplicate !== undefined) {
      return { found: false, reason: 'duplicate-column', headerRow: r + 1, column: duplicate }
    }

    const rows: Array<Record<string, CellValue>> = []
    for (let i = r + 1; i < grid.length; i++) {
      const record: Record<string, CellValue> = {}
      let empty = true
      for (let c = 0; c < width; c++) {
        const key = columns[c]
        if (!key) continue
        const value = grid[i]?.[c] ?? null
        record[key] = typeof value === 'string' ? value.trim() : value
        if (record[key] !== null && record[key] !== '') empty = false
      }
      if (!empty) rows.push(record)
    }

    return { found: true, sheet: { headers, headerRow: r + 1, rows } }
  }

  return { found: false, reason: 'no-header', depth, seen }
}

/** Which of `wanted` the sheet does not carry. Document 4 §6: a refused file names them. */
export function missingColumns(sheet: Sheet, wanted: readonly string[]): string[] {
  const present = new Set(sheet.headers.map(headerKey))
  return wanted.filter((column) => !present.has(headerKey(column)))
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
