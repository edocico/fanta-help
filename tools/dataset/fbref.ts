import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeName } from '@shared/domain'
import { optionalInt, optionalText, readCsvFile, requireColumns, type Table } from './csv'
import { headerKey } from './xlsx'

/**
 * Stage 2 of document 4 §2: FBref, and every line of it is optional.
 *
 * What it adds is what Fantacalcio.it does not have — minutes, starts, total
 * appearances, clean sheets, and the birth year. What it must never do is take
 * anything away: `hasFbref: false` and four empty columns is a working dataset,
 * and the app hides the columns instead of showing them empty. So nothing in
 * here throws out of the stage. A file that will not parse is named and skipped;
 * a player who cannot be placed keeps his four nulls and appears in the report.
 *
 * The one number that surprises: **`Born` is a year, not a date.** The league
 * tables carry a four-digit year; the full date lives on each player's own page,
 * which this pipeline does not fetch. Hence `birthYear` in the dataset next to
 * `birthDate`, rather than a `birthDate` that sometimes holds four characters
 * and sometimes ten.
 */

/** The three exports of document 4 §3, named `<season>-<table>.csv`. */
const TABLES = {
  standard: {
    markers: ['Player', 'Squad'],
    // `Born` is what only this table has, and it is still not required: FBref has
    // already deleted whole families of columns once, in January 2026, and a
    // Standard export that lost it can go on supplying the three counters. Its
    // absence costs the birth years and says so in the report — refusing the file
    // would cost them too, and the counters with them.
    required: ['Player', 'Squad', 'MP', 'Starts', 'Min'],
  },
  'playing-time': {
    markers: ['Player', 'Squad'],
    required: ['Player', 'Squad', 'MP', 'Starts', 'Min'],
  },
  goalkeeping: {
    markers: ['Player', 'Squad'],
    required: ['Player', 'Squad', 'CS'],
  },
} as const

export type TableKind = keyof typeof TABLES

/** `2025-26-playing-time.csv` → season and table. */
const FILE_PATTERN = new RegExp(`^(\\d{4}-\\d{2})-(${Object.keys(TABLES).join('|')})\\.csv$`, 'i')

export interface FbrefRow {
  name: string
  /** As FBref spells it. Mapped onto the listone's spelling by the caller. */
  team: string
  birthYear: number | null
  matchesPlayed: number | null
  starts: number | null
  minutes: number | null
  cleanSheets: number | null
}

export interface FbrefSeason {
  seasonId: string
  rows: FbrefRow[]
  files: string[]
}

export interface FbrefInput {
  seasons: FbrefSeason[]
  /** Anything that went wrong, for the report. Never thrown. */
  problems: string[]
}

const empty = (name: string, team: string): FbrefRow => ({
  name,
  team,
  birthYear: null,
  matchesPlayed: null,
  starts: null,
  minutes: null,
  cleanSheets: null,
})

/**
 * One export into rows, merged onto what earlier tables of the same season said.
 *
 * The precedence is document 4 §3's: Playing Time is "più completa della
 * Standard" for the three counters, so it overwrites them; Standard is the only
 * one that carries `Born`; Goalkeeping contributes clean sheets and nothing
 * else — its `Starts` counts starts in goal, and letting it overwrite the
 * general one would quietly rewrite every keeper's season.
 */
export function mergeTable(into: Map<string, FbrefRow>, table: Table, kind: TableKind, label: string): void {
  requireColumns(table, [...TABLES[kind].required], label)

  for (const row of table.rows) {
    const name = optionalText(row, 'Player')
    const team = optionalText(row, 'Squad')
    if (!name || !team) continue

    const key = `${normalizeName(name)}|${normalizeName(team)}`
    const current = into.get(key) ?? empty(name, team)

    if (kind === 'standard') {
      current.birthYear = optionalInt(row, 'Born') ?? current.birthYear
      current.matchesPlayed = current.matchesPlayed ?? optionalInt(row, 'MP')
      current.starts = current.starts ?? optionalInt(row, 'Starts')
      current.minutes = current.minutes ?? optionalInt(row, 'Min')
    } else if (kind === 'playing-time') {
      current.matchesPlayed = optionalInt(row, 'MP') ?? current.matchesPlayed
      current.starts = optionalInt(row, 'Starts') ?? current.starts
      current.minutes = optionalInt(row, 'Min') ?? current.minutes
    } else {
      current.cleanSheets = optionalInt(row, 'CS') ?? current.cleanSheets
    }

    into.set(key, current)
  }
}

/**
 * Reads whatever is in `input/fbref/`, and is content with whatever it finds.
 *
 * A file that does not parse costs its own columns and nothing else. A file
 * whose name does not fit the pattern is *reported* rather than ignored:
 * `2025-26-standard-stats.csv` sitting there doing nothing looks exactly like
 * FBref having no data for that season.
 */
export function readFbref(dir: string): FbrefInput {
  const problems: string[] = []
  if (!existsSync(dir)) {
    return { seasons: [], problems: [`${dir}: la cartella non c'è, lo stadio FBref non gira`] }
  }

  const bySeason = new Map<string, { rows: Map<string, FbrefRow>; files: string[] }>()
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    const match = FILE_PATTERN.exec(name)
    if (!match) {
      problems.push(
        `${name}: nome non riconosciuto, file ignorato. Atteso <stagione>-<tabella>.csv ` +
          `con tabella fra ${Object.keys(TABLES).join(', ')}`,
      )
      continue
    }
    const seasonId = match[1]
    const kind = match[2].toLowerCase() as TableKind
    const season = bySeason.get(seasonId) ?? { rows: new Map<string, FbrefRow>(), files: [] }

    try {
      const table = readCsvFile(join(dir, name), [...TABLES[kind].markers])
      mergeTable(season.rows, table, kind, name)
      season.files.push(name)
      if (kind === 'standard' && !table.headers.map(headerKey).includes(headerKey('Born'))) {
        problems.push(`${name}: nessuna colonna Born, la stagione resta senza anni di nascita`)
      }
    } catch (error) {
      // The reader already spells the file it was reading into its message; a
      // second copy of the name in front of it reads like two different files.
      const message = error instanceof Error ? error.message : String(error)
      problems.push(message.includes(name) ? message : `${name}: ${message}`)
    }
    bySeason.set(seasonId, season)
  }

  const seasons = [...bySeason]
    .filter(([, season]) => season.files.length > 0)
    .map(([seasonId, season]) => ({ seasonId, rows: [...season.rows.values()], files: season.files }))
    .sort((a, b) => a.seasonId.localeCompare(b.seasonId))

  return { seasons, problems }
}
