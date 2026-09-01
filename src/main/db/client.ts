import Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { raise } from '@shared/errors'
import * as schema from './schema'
import { backupDatabase } from './backup'
import { appInstance } from './schema'
import { runMigrations } from './migrate'

export type Db = BetterSQLite3Database<typeof schema>

let connection: Database.Database | null = null
let database: Db | null = null

export function databasePath(): string {
  return join(app.getPath('userData'), 'fanta-help.db')
}

/** Opens the connection, applies the pragmas, runs the migrations. Idempotent. */
export function openDb(): Db {
  if (database) return database

  const conn = new Database(databasePath())

  try {
    // Pragmas are per-connection and not stored in the file: they must be set on
    // every open. Without `foreign_keys = ON` half the constraints of document 1
    // do not exist, and nothing announces it.
    conn.pragma('journal_mode = WAL')
    conn.pragma('foreign_keys = ON')
    conn.pragma('synchronous = NORMAL')

    const db = drizzle(conn, { schema })
    runMigrations(db)

    connection = conn
    database = db
    return db
  } catch (e) {
    // Never leave a half-initialised handle behind: the next open would find the
    // file locked and blame the wrong thing.
    conn.close()
    throw e
  }
}

export function closeDb(): void {
  connection?.close()
  connection = null
  database = null
}

/**
 * The backup document 4 §6 puts before every import.
 *
 * It lives here and not in the import service because it needs two things the
 * service is not allowed to touch: the raw better-sqlite3 handle, for the online
 * backup API, and `userData`, which comes from electron.
 */
export function takeBackup(): Promise<string> {
  if (!connection) raise('DB_UNAVAILABLE')
  return backupDatabase(connection, app.getPath('userData'))
}

export function foreignKeysEnabled(): boolean {
  return connection?.pragma('foreign_keys', { simple: true }) === 1
}

/**
 * The single `app_instance` row identifies this installation. Its uuid is what
 * `auction_log.actor_uuid` and `league_snapshot.produced_by` record, so it has to
 * exist before anything is written, and it must never change afterwards.
 */
export function ensureInstance(db: Db): { uuid: string; label: string | null } {
  const existing = db.select().from(appInstance).where(eq(appInstance.id, 1)).get()
  if (existing) return { uuid: existing.uuid, label: existing.label }

  const row = { id: 1, uuid: randomUUID(), label: null, createdAt: Date.now() }
  db.insert(appInstance).values(row).run()
  return { uuid: row.uuid, label: row.label }
}
