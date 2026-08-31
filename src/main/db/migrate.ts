import { app } from 'electron'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from './schema'

/**
 * Where the generated SQL lives at run time.
 *
 * This is the trap the whole task exists to get right. A relative path resolves
 * inside app.asar once the app is packaged, and Drizzle fails on
 * `meta/_journal.json` with an error that says nothing about archives. The
 * `drizzle/` folder is shipped as an electron-builder extraResource precisely so
 * that it sits *next to* app.asar, reachable through process.resourcesPath.
 */
export function migrationsFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
}

export function runMigrations(db: BetterSQLite3Database<typeof schema>): void {
  migrate(db, { migrationsFolder: migrationsFolder() })
}
