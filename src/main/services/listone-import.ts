import { basename } from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'
import type { Output } from '@shared/contracts'
import { normalizeName } from '@shared/domain'
import { appError, DomainError, raise, type AppError } from '@shared/errors'
import {
  collectRows,
  LISTONE_MARKERS,
  MAX_REJECTED_ROWS,
  QUOTAZIONI_COLUMNS,
  quotazione,
  seasonFromFilename,
  seasonLabel,
  type Quotazione,
} from '@shared/listone'
import { findSheet, headerKey, type CellValue, type Sheet } from '@shared/sheet'

/** `2026-27`, the shape `season.id` carries everywhere else. */
const SEASON_ID = /^\d{4}-\d{2}$/
import type { Db } from '../db/client'
import {
  player,
  playerMantraRole,
  playerSeasonStat,
  season,
  serieATeam,
} from '../db/schema'
import { refuseIfFrozen } from './dataset-import'

/**
 * The XLSX import of document 4 §6, "Dal file XLSX".
 *
 * It exists so the app works when the dataset repo is out of reach, and to update
 * quotazioni mid-market without regenerating the dataset. Which makes what it
 * does *not* do the important half: the quotazioni file carries no statistics, so
 * an XLSX import moves roles and prices and leaves the history exactly where it
 * was. Replacing it with nothing would silently empty every performance column.
 *
 * Two entry points on purpose. The preview reports; the import refuses. Rule 2 of
 * CLAUDE.md: the interface greys out the button as a courtesy, the service checks
 * again, and both quote the same AppError so they can never word it differently.
 */

export type ListonePreview = Output<'listone.preview'>
export type ListoneReport = Output<'listone.import'>

export type ListoneContext = {
  db: Db
  /** Injected: opening a workbook needs exceljs, which handlers.ts must not import. */
  readGrid: (file: string) => Promise<CellValue[][]>
  backup: () => Promise<string>
}

/** Everything both entry points work out from the file, before deciding anything. */
type Reading = {
  sheet: Sheet | null
  rows: Quotazione[]
  recognised: string[]
  unrecognised: string[]
  missing: string[]
  rejected: string[]
  duplicates: number[]
  refusal: AppError | null
}

async function read(file: string, ctx: ListoneContext): Promise<Reading> {
  const empty = {
    sheet: null,
    rows: [],
    recognised: [],
    unrecognised: [],
    missing: [],
    rejected: [],
    duplicates: [],
  }

  let grid: CellValue[][]
  try {
    grid = await ctx.readGrid(file)
  } catch {
    return { ...empty, refusal: appError('XLSX_UNREADABLE') }
  }

  const found = findSheet(grid, LISTONE_MARKERS)
  if (!found.found) {
    return {
      ...empty,
      refusal:
        found.reason === 'duplicate-column'
          ? appError('XLSX_DUPLICATE_COLUMN', { column: found.column })
          : appError('XLSX_NO_HEADER', { columns: LISTONE_MARKERS.join(', ') }),
    }
  }

  const { sheet } = found
  const outcome = collectRows(sheet, quotazione, QUOTAZIONI_COLUMNS)

  // What the file has that we use, and what it has that we ignore. Document 4 §6
  // asks the preview to show the columns it recognised; the other half is worth
  // showing too, because an unrecognised column is how a changed file announces
  // itself before anything goes wrong.
  const wanted = new Set(QUOTAZIONI_COLUMNS.map(headerKey))
  const recognised = sheet.headers.filter((h) => wanted.has(headerKey(h)))
  const unrecognised = sheet.headers.filter((h) => h !== '' && !wanted.has(headerKey(h)))

  const refusal =
    outcome.missing.length > 0
      ? appError('XLSX_MISSING_COLUMNS', { columns: outcome.missing.join(', ') })
      : // Nothing to import is not a quiet no-op: on an empty database it would
        // create the season, and `dataset.list` answering 1 sends the app past the
        // onboarding screen — which in T8 is the only way in to this import.
        outcome.rows.length === 0
        ? appError('XLSX_NO_ROWS')
        : outcome.rejected.length > MAX_REJECTED_ROWS
          ? appError('XLSX_TOO_MANY_BAD_ROWS', {
              n: outcome.rejected.length,
              total: sheet.rows.length,
            })
          : outcome.duplicates.length > 0
            ? appError('XLSX_DUPLICATE_IDS', { ids: outcome.duplicates.join(', ') })
            : null

  return {
    sheet,
    rows: outcome.rows,
    recognised,
    unrecognised,
    missing: outcome.missing,
    rejected: outcome.rejected,
    duplicates: outcome.duplicates,
    refusal,
  }
}

/** The seasons already installed, with how much history each would keep. */
function installedSeasons(db: Db): ListonePreview['seasons'] {
  return db
    .select()
    .from(season)
    // Ordered, because the onboarding proposes `.at(-1)` as "la stagione più
    // recente presente" (document 4 §6) and rowid order is insertion order: a
    // 2023-24 imported after a 2026-27 would come last and be proposed.
    .orderBy(season.id)
    .all()
    .map((s) => {
      const counted = db
        .select({ n: sql<number>`count(*)` })
        .from(playerSeasonStat)
        .where(
          inArray(
            playerSeasonStat.identityKey,
            db
              .select({ key: player.identityKey })
              .from(player)
              .where(eq(player.seasonId, s.id)),
          ),
        )
        .get()

      return { id: s.id, label: s.label, stats: counted?.n ?? 0 }
    })
}

/**
 * Reads the file and says what would happen, without writing anything.
 *
 * Never raises for a bad file: document 4 §6 wants the refusal *shown* — "mostra
 * quali colonne non ha riconosciuto" — and a thrown error would leave the screen
 * with a message and no way to see the header it did find.
 */
export async function previewListone(
  input: { filePath: string },
  ctx: ListoneContext,
): Promise<ListonePreview> {
  const reading = await read(input.filePath, ctx)
  const file = basename(input.filePath)

  return {
    file,
    seasonGuess: seasonFromFilename(file),
    seasons: installedSeasons(ctx.db),
    headerRow: reading.sheet?.headerRow ?? null,
    recognised: reading.recognised,
    unrecognised: reading.unrecognised,
    missing: reading.missing,
    validRows: reading.rows.length,
    // Enough to recognise a pattern, not enough to become the screen.
    rejected: reading.rejected.slice(0, 10),
    rejectedTotal: reading.rejected.length,
    duplicates: reading.duplicates,
    refusal: reading.refusal,
  }
}

export async function importListone(
  input: { filePath: string; seasonId: string },
  ctx: ListoneContext,
): Promise<ListoneReport> {
  const { db } = ctx

  refuseIfFrozen(db)

  // Rule 2: the field in the onboarding screen checks this too, as a courtesy.
  // This is the check that counts — `season.id` is a primary key that `league`
  // and `player` reference and nothing in the app ever deletes, so a typo
  // confirmed once stays in the database for good.
  if (!SEASON_ID.test(input.seasonId)) raise('XLSX_SEASON_INVALID', { seasonId: input.seasonId })

  const reading = await read(input.filePath, ctx)
  // The interface disables the button; this is the check that counts. Thrown as a
  // DomainError carrying the AppError the preview already showed — a plain Error
  // would reach the renderer as UNKNOWN and replace a message that names the
  // missing column with "Qualcosa non ha funzionato".
  if (reading.refusal) throw new DomainError(reading.refusal)
  if (!reading.sheet) raise('XLSX_UNREADABLE')

  const backup = await ctx.backup()

  const now = Date.now()
  let added = 0
  let updated = 0
  let delisted = 0
  let restored = 0
  let label = ''
  let seasonCreated = false

  db.transaction((tx) => {
    refuseIfFrozen(tx)

    // Read inside the transaction, not before the backup: the same await that
    // makes the invariant-17 check need repeating would let a season appear
    // between "does it exist" and "insert it", and the branch would pick wrong.
    const existing = tx.select().from(season).where(eq(season.id, input.seasonId)).get()
    seasonCreated = existing === undefined
    label = existing?.label ?? seasonLabel(input.seasonId)

    // `dataset_version` and `has_fbref` describe the *dataset* this season was
    // built from, and an XLSX patches quotazioni on top of it without replacing
    // it. Overwriting them would claim the history came from a file that has
    // none, and blank the performance columns of players whose stats are still
    // sitting in the table — so the update sets neither.
    tx.insert(season)
      .values({
        id: input.seasonId,
        label,
        // No manifest was involved, and saying 'v1' would claim otherwise.
        datasetVersion: 'xlsx',
        source: 'xlsx',
        hasFbref: 0,
        importedAt: now,
      })
      .onConflictDoUpdate({
        target: season.id,
        set: { source: 'xlsx', importedAt: now },
      })
      .run()

    // The listone names its clubs and nothing else about them: `code` belongs to
    // the dataset pipeline, so a club met here for the first time simply has none,
    // and one that already exists keeps the code it was given.
    for (const name of [...new Set(reading.rows.map((r) => r.team))].sort()) {
      tx.insert(serieATeam)
        .values({ seasonId: input.seasonId, name, code: null })
        .onConflictDoNothing({ target: [serieATeam.seasonId, serieATeam.name] })
        .run()
    }

    const teamId = new Map(
      tx
        .select({ id: serieATeam.id, name: serieATeam.name })
        .from(serieATeam)
        .where(eq(serieATeam.seasonId, input.seasonId))
        .all()
        .map((t) => [t.name, t.id]),
    )

    const before = tx
      .select({ sourceId: player.sourceId, id: player.id, delistedAt: player.delistedAt })
      .from(player)
      .where(eq(player.seasonId, input.seasonId))
      .all()
    const knownBefore = new Map(before.map((p) => [p.sourceId, p]))

    for (const row of reading.rows) {
      const columns = {
        seasonId: input.seasonId,
        sourceId: row.sourceId,
        identityKey: `fc-${row.sourceId}`,
        name: row.name,
        nameNormalized: normalizeName(row.name),
        serieATeamId: teamId.get(row.team) as number,
        roleClassic: row.roleClassic,
        qtClassicInitial: row.qtClassicInitial,
        qtClassicCurrent: row.qtClassicCurrent,
        qtMantraInitial: row.qtMantraInitial,
        qtMantraCurrent: row.qtMantraCurrent,
        fvmClassic: row.fvmClassic,
        fvmMantra: row.fvmMantra,
        delistedAt: null,
      }

      tx.insert(player)
        .values(columns)
        .onConflictDoUpdate({
          target: [player.seasonId, player.sourceId],
          // `birth_date`, `birth_year`, `penalty_taker` and the external ids are
          // absent from this file, not empty in it. Listing only what the listone
          // carries is what keeps an XLSX import from erasing them.
          set: columns,
        })
        .run()

      const was = knownBefore.get(row.sourceId)
      if (!was) added += 1
      else {
        updated += 1
        if (was.delistedAt !== null) restored += 1
      }
    }

    // Invariant 10, on this path too: purchases, targets and plans point at these
    // rows, so whoever left the listone is marked and never removed.
    const incoming = new Set(reading.rows.map((r) => r.sourceId))
    for (const p of before) {
      if (incoming.has(p.sourceId) || p.delistedAt !== null) continue
      tx.update(player).set({ delistedAt: now }).where(eq(player.id, p.id)).run()
      delisted += 1
    }

    const idBySourceId = new Map(
      tx
        .select({ id: player.id, sourceId: player.sourceId })
        .from(player)
        .where(eq(player.seasonId, input.seasonId))
        .all()
        .map((p) => [p.sourceId, p.id]),
    )

    const incomingIds = reading.rows.map((r) => idBySourceId.get(r.sourceId) as number)
    for (let i = 0; i < incomingIds.length; i += 400) {
      tx.delete(playerMantraRole)
        .where(inArray(playerMantraRole.playerId, incomingIds.slice(i, i + 400)))
        .run()
    }

    for (const row of reading.rows) {
      const id = idBySourceId.get(row.sourceId) as number
      row.rolesMantra.forEach((role, position) => {
        tx.insert(playerMantraRole).values({ playerId: id, roleCode: role, position }).run()
      })
    }

    // Same as the dataset path: contentless, no triggers, rebuilt where reference
    // data changes. Skipping it here would leave the search index describing the
    // listone before this one.
    tx.run(sql`insert into player_fts(player_fts) values('delete-all')`)
    const everyPlayer = tx
      .select({ id: player.id, name: player.name, teamName: serieATeam.name })
      .from(player)
      .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
      .all()
    for (const row of everyPlayer) {
      tx.run(
        sql`insert into player_fts(rowid, name, team_name) values (${row.id}, ${row.name}, ${row.teamName})`,
      )
    }
  })

  const stats = db
    .select({ n: sql<number>`count(*)` })
    .from(playerSeasonStat)
    .where(
      inArray(
        playerSeasonStat.identityKey,
        db.select({ key: player.identityKey }).from(player).where(eq(player.seasonId, input.seasonId)),
      ),
    )
    .get()

  return {
    seasonId: input.seasonId,
    label,
    seasonCreated,
    added,
    updated,
    delisted,
    restored,
    teams: new Set(reading.rows.map((r) => r.team)).size,
    backup,
    /** Left exactly as it was. Zero means the performance columns stay empty. */
    statsUntouched: stats?.n ?? 0,
  }
}
