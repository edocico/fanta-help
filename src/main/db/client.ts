import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'

/**
 * Packaging spike only. T3 replaces this with the Drizzle schema, drizzle-kit
 * migrations and the absolute migrations path, and drops `spike_boot`.
 */

let handle: Database.Database | null = null

export function openDb(): Database.Database {
  if (handle) return handle

  const db = new Database(databasePath())

  try {
    // Pragmas are per-connection, not stored in the file: they must be set on
    // every open. Without `foreign_keys = ON` half the constraints do not exist.
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')

    db.exec(`
      CREATE TABLE IF NOT EXISTS spike_boot (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        booted_at TEXT NOT NULL
      )
    `)
  } catch (e) {
    // Do not leave an open handle behind on a half-initialised connection:
    // the next open would find the file locked and blame the wrong thing.
    db.close()
    throw e
  }

  handle = db
  return db
}

export function databasePath(): string {
  return join(app.getPath('userData'), 'fanta-help.db')
}

export function closeDb(): void {
  handle?.close()
  handle = null
}

export function foreignKeysEnabled(db: Database.Database): boolean {
  return db.pragma('foreign_keys', { simple: true }) === 1
}

/** Writes one row and reads the table back. The whole point of the spike. */
export function recordBoot(db: Database.Database): { bootCount: number; bootedAt: string } {
  const write = db.transaction(() => {
    // strftime, not datetime(): the column is documented as an ISO-8601 UTC
    // instant, and datetime('now') yields a space-separated, unmarked one.
    db.prepare(`INSERT INTO spike_boot (booted_at) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now'))`).run()
    return db
      .prepare(`SELECT COUNT(*) AS n, MAX(booted_at) AS last FROM spike_boot`)
      .get() as { n: number; last: string }
  })

  const row = write()
  return { bootCount: row.n, bootedAt: row.last }
}
