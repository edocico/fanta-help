import { readFileSync } from 'node:fs'
import { headerKey } from './xlsx'

/**
 * Reading a CSV the way document 4 §6 requires of the XLSX, for the same reason.
 *
 * FBref exports are hand-made once a season from a page that changes shape
 * between them — it has already lost a whole family of columns once, in January
 * 2026. So the discipline of `xlsx.ts` applies unchanged: the header row is
 * *found*, never assumed to be the first, and columns are read by name, never by
 * position. Three things this reader tolerates that the XLSX one does not, each
 * because the export really does it:
 *
 *  - a **group header above the real one**. Multi-level tables export a first
 *    line like `,,,,Playing Time,Playing Time,…`. Searching for the markers
 *    steps over it without needing to know it was there.
 *  - **header rows repeated in the body**, every twenty-five rows or so.
 *  - **duplicate column names**. Goalkeeping carries `Save%` twice. Refusing the
 *    file over a column nobody reads would be pedantry; refusing it when the
 *    ambiguous name is one we actually want is the whole point, so the two cases
 *    are separated and only the second throws.
 */

export interface Table {
  /** Header texts exactly as the file spells them, in column order. */
  headers: string[]
  /** 1-based index of the header row, so errors can point at it. */
  headerRow: number
  /** One record per data row, keyed by `headerKey(header)`. First wins on a tie. */
  rows: Array<Record<string, string>>
  /** Header keys that appear more than once. Only fatal if one is wanted. */
  duplicates: string[]
}

/** How far down to look before giving up on finding the header row. */
const HEADER_SEARCH_DEPTH = 20

/**
 * RFC 4180 by hand rather than by dependency: quotes, doubled quotes inside
 * them, embedded newlines and CRLF. Thirty lines against a parser library is a
 * trade the CLAUDE.md rule on dependencies makes for us.
 */
function splitRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let dirty = false

  const endField = (): void => {
    record.push(field)
    field = ''
  }
  const endRecord = (): void => {
    endField()
    if (dirty) records.push(record)
    record = []
    dirty = false
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char !== '"') {
        field += char
      } else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else {
        quoted = false
      }
      dirty = true
      continue
    }
    if (char === '"') {
      quoted = true
      dirty = true
    } else if (char === ',') {
      endField()
    } else if (char === '\n') {
      endRecord()
    } else if (char !== '\r') {
      field += char
      if (char !== ' ') dirty = true
    }
  }
  if (dirty || field !== '' || record.length > 0) endRecord()
  return records
}

/**
 * Reads a CSV keyed by header name.
 *
 * `markers` are the headers that identify the header row — for FBref, `Player`
 * and `Squad`. They are matched through `headerKey`, so case and spacing do not
 * matter. `label` only ever appears in error messages.
 */
export function parseCsv(text: string, markers: string[], label: string): Table {
  // The BOM as an escape and not as itself: a literal U+FEFF in the source is
  // invisible in every editor and the linter is right to refuse it.
  const records = splitRecords(text.replace(/^\uFEFF/, ''))
  const wanted = markers.map(headerKey)
  const depth = Math.min(HEADER_SEARCH_DEPTH, records.length)
  const seen: string[] = []

  for (let r = 0; r < depth; r++) {
    const texts = records[r].map((cell) => cell.trim())
    const keys = texts.map(headerKey)
    seen.push(texts.filter(Boolean).join(' | '))
    if (!wanted.every((marker) => keys.includes(marker))) continue

    // Trailing empties are formatting, not columns. Cut at the last named one.
    const width = keys.reduce((last, key, i) => (key ? i + 1 : last), 0)
    const headers = texts.slice(0, width)
    const columns = keys.slice(0, width)
    const duplicates = [...new Set(columns.filter((key, i) => key !== '' && columns.indexOf(key) !== i))]

    const rows: Array<Record<string, string>> = []
    for (let i = r + 1; i < records.length; i++) {
      const cells = records[i]
      // The header, repeated mid-table. Compared on the markers rather than the
      // whole row: a body row that happens to hold every marker verbatim is a
      // header by any useful definition.
      const repeated = wanted.every((marker) =>
        cells.slice(0, width).some((cell) => headerKey(cell.trim()) === marker),
      )
      if (repeated) continue

      const record: Record<string, string> = {}
      let empty = true
      for (let c = 0; c < width; c++) {
        const key = columns[c]
        if (!key || key in record) continue // first occurrence wins
        const value = (cells[c] ?? '').trim()
        record[key] = value
        if (value !== '') empty = false
      }
      if (!empty) rows.push(record)
    }

    return { headers, headerRow: r + 1, rows, duplicates }
  }

  throw new Error(
    `${label}: nessuna riga fra le prime ${depth} contiene tutte le colonne ${markers.join(', ')}.\n` +
      `Righe lette:\n${seen.map((row, i) => `  ${i + 1}: ${row || '(vuota)'}`).join('\n')}`,
  )
}

export function readCsvFile(file: string, markers: string[]): Table {
  return parseCsv(readFileSync(file, 'utf8'), markers, file)
}

/**
 * Document 4 §6 again: a refused file has to say which columns it did not
 * recognise. A wanted column that appears twice is refused with the others,
 * because reading the first of two identically named columns is a coin toss.
 */
export function requireColumns(table: Table, wanted: string[], label: string): void {
  const present = new Set(Object.keys(table.rows[0] ?? {}).concat(table.headers.map(headerKey)))
  const missing = wanted.filter((column) => !present.has(headerKey(column)))
  const ambiguous = wanted.filter((column) => table.duplicates.includes(headerKey(column)))
  if (missing.length === 0 && ambiguous.length === 0) return
  throw new Error(
    `${label}: ` +
      [
        missing.length > 0 ? `colonne non riconosciute: ${missing.join(', ')}` : '',
        ambiguous.length > 0 ? `colonne ripetute, quindi ambigue: ${ambiguous.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ') +
      `.\n  intestazione trovata alla riga ${table.headerRow}: ${table.headers.join(' | ')}`,
  )
}

/**
 * A whole number, or null when the cell is empty.
 *
 * `Min` arrives as `2,874`: FBref groups thousands with a comma, and a CSV field
 * that contains a comma arrives quoted. Stripping it here rather than at every
 * call site is the difference between 2874 minutes and 2 minutes.
 */
export function optionalInt(row: Record<string, string>, column: string): number | null {
  const raw = (row[headerKey(column)] ?? '').replace(/[,\s]/g, '')
  if (raw === '') return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : null
}

/** Non-empty text, or null. */
export function optionalText(row: Record<string, string>, column: string): string | null {
  const value = (row[headerKey(column)] ?? '').trim()
  return value === '' ? null : value
}
