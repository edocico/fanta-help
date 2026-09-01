import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { backupsToPrune } from '@shared/domain'

/**
 * The backup that precedes every import, per document 4 §6, and the rotation
 * that keeps the last ten.
 *
 * Two details are not decoration:
 *
 * **The online backup API, not a file copy.** The connection runs in WAL mode,
 * so at any moment part of the committed state lives in `-wal` and not in the
 * `.db` file. Copying the file alone produces an archive that is missing the most
 * recent writes and looks perfectly valid — the worst shape a backup can take.
 * `conn.backup()` goes through SQLite itself and yields a consistent database.
 *
 * **The timestamp is written sortable, never parsed back.** Nothing here reads a
 * date: rotation is `sort()` on the file names, which is why the stamp is fixed
 * width and ordered from the most significant digit down.
 */

export const BACKUPS_KEPT = 10

export function backupsDir(userData: string): string {
  return join(userData, 'backups')
}

/** `2026-09-01T09:34:12.123Z` → `20260901T093412123`: fixed width, sorts by age. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', '')
}

/**
 * Copies the database aside and prunes the oldest, returning the path written.
 *
 * Pruning happens *after* the new file exists, so the ten that survive always
 * include the one just taken. Prune first and a crash in between would leave
 * nine backups and no new one.
 */
export async function backupDatabase(
  conn: Database.Database,
  userData: string,
  now: Date = new Date(),
): Promise<string> {
  const dir = backupsDir(userData)
  mkdirSync(dir, { recursive: true })

  const destination = join(dir, `fanta-help-${stamp(now)}.db`)
  await conn.backup(destination)

  const present = readdirSync(dir).filter((name) => name.endsWith('.db'))
  for (const name of backupsToPrune(present, BACKUPS_KEPT)) {
    rmSync(join(dir, name), { force: true })
  }

  return destination
}
