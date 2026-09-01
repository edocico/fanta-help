import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { eq, inArray, sql } from 'drizzle-orm'
import {
  dataset as datasetSchema,
  manifest as manifestSchema,
  type Dataset,
  type ManifestVersion,
} from '@shared/dataset'
import type { Output } from '@shared/contracts'
import { normalizeName } from '@shared/domain'
import { raise } from '@shared/errors'
import type { Db } from '../db/client'
import {
  league,
  player,
  playerExternalId,
  playerMantraRole,
  playerSeasonStat,
  season,
  serieATeam,
} from '../db/schema'

/**
 * The import of document 4 §6, minus the network.
 *
 * Steps 1 to 5 of that section are all here except the download itself: the
 * manifest is read from a folder rather than fetched from the private dataset
 * repo, and the file beside it is the one the sha256 is checked against. What is
 * deferred, and what has to arrive with it, is written down under T7b in the
 * roadmap — not left to be rediscovered.
 *
 * The whole write is one transaction. Half an imported listone is worse than no
 * import: quotations from the new one and roles from the old would look like a
 * working database and price players wrong for a whole auction.
 */

/**
 * Derived from the contract, never rewritten beside it — the convention
 * shared/types.ts states. Written out by hand, a field added here and not there
 * would compile: register.ts does not parse the output, so the divergence would
 * only show up as a missing key on screen.
 */
export type ImportReport = Output<'dataset.import'>

export type ImportContext = {
  db: Db
  /** Takes the backup of document 4 §6 and returns where it landed. */
  backup: () => Promise<string>
  emit?: (progress: { done: number; total: number; label: string }) => void
}

const STEPS = 5

/**
 * SQLite compiled with the old default refuses a statement carrying more than
 * 999 bound parameters, and the failure names the statement rather than the
 * count. Nothing here is ever close on purpose.
 */
const CHUNK = 400

function chunked<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Reads and validates `<dir>/manifest.json`. */
function readManifest(dir: string): ReturnType<typeof manifestSchema.parse> {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) raise('DATASET_MANIFEST_UNREADABLE')

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    raise('DATASET_MANIFEST_UNREADABLE')
  }

  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) raise('DATASET_MANIFEST_UNREADABLE')
  return parsed.data
}

/**
 * Reads the file the manifest points at and checks it against the digest the
 * manifest carries — step 3 of document 4 §6, "se non corrisponde, si ferma".
 *
 * The check happens before the bytes are decompressed, let alone parsed: a file
 * that fails it is not a dataset with a problem, it is an unknown file, and
 * unzipping it first would be reading something nobody vouched for.
 */
function readVerified(dir: string, entry: ManifestVersion): Dataset {
  const file = join(dir, entry.url)
  if (!existsSync(file)) raise('DATASET_FILE_MISSING', { file: entry.url })

  const bytes = readFileSync(file)
  if (sha256(bytes) !== entry.sha256) raise('DATASET_CHECKSUM_MISMATCH', { file: entry.url })

  let raw: unknown
  try {
    raw = JSON.parse(gunzipSync(bytes).toString('utf8'))
  } catch {
    raise('DATASET_INVALID')
  }

  const parsed = datasetSchema.safeParse(raw)
  if (!parsed.success) raise('DATASET_INVALID')
  return parsed.data
}

/**
 * Invariant 17, and both import paths call it twice on purpose.
 *
 * Once before the work, because it costs one query and refusing *after* having
 * copied a 100 MB database aside would be rude for no reason. Then again as the
 * first statement inside the transaction, because between the two there is an
 * `await` on the backup, `ipcMain.handle` does not serialise invokes, and
 * document 1 §5 is explicit that invariants are enforced "dentro una
 * transazione". A check separated from the write it guards by an await guards
 * the past.
 */
export function refuseIfFrozen(on: Pick<Db, 'select'>): void {
  const frozen = on
    .select({ id: league.id })
    .from(league)
    .where(inArray(league.status, ['auction', 'review', 'closed']))
    .all()
  if (frozen.length > 0) raise('DATASET_LOCKED')
}

export async function importDataset(
  input: { dir: string; seasonId?: string },
  ctx: ImportContext,
): Promise<ImportReport> {
  const { db } = ctx
  const step = (done: number, label: string): void => ctx.emit?.({ done, total: STEPS, label })

  refuseIfFrozen(db)

  step(1, 'Lettura del manifest')
  const manifest = readManifest(input.dir)

  const wanted = input.seasonId
  const entrySeason = wanted
    ? manifest.seasons.find((s) => s.seasonId === wanted)
    : // Newest last: the manifest is written sorted by seasonId.
      manifest.seasons[manifest.seasons.length - 1]
  if (!entrySeason) raise('DATASET_SEASON_MISSING', { seasonId: wanted ?? '—' })

  const entry = entrySeason.versions.find((v) => v.version === entrySeason.latest)
  if (!entry) {
    raise('DATASET_VERSION_MISSING', {
      seasonId: entrySeason.seasonId,
      version: entrySeason.latest,
    })
  }

  // Step 2: compare `latest` with what is installed for that season.
  const installed = db
    .select({ version: season.datasetVersion })
    .from(season)
    .where(eq(season.id, entrySeason.seasonId))
    .get()

  if (installed?.version === entry.version) {
    // Straight to the end: a progress bar wired to this topic would otherwise sit
    // at 1 of 5 forever on what is, most days, the only outcome.
    step(STEPS, 'Già aggiornato')
    return {
      seasonId: entrySeason.seasonId,
      version: entry.version,
      upToDate: true,
      added: 0,
      updated: 0,
      delisted: 0,
      restored: 0,
      teams: 0,
      stats: 0,
      backup: null,
      hasFbref: entry.hasFbref,
      hasExternalIds: entry.hasExternalIds,
    }
  }

  step(2, 'Verifica del file')
  const data = readVerified(input.dir, entry)

  // A manifest that disagrees with the file it points at is not a mismatch to
  // paper over: one of the two is stale, and guessing which would import a
  // season under another season's name.
  if (data.seasonId !== entrySeason.seasonId || data.version !== entry.version) {
    raise('DATASET_INVALID')
  }

  const teamsByName = new Map(data.serieATeams.map((t) => [t.name, t]))
  for (const p of data.players) {
    if (!teamsByName.has(p.team)) raise('DATASET_INVALID')
  }

  step(3, 'Backup del database')
  const backup = await ctx.backup()

  const now = Date.now()
  let added = 0
  let updated = 0
  let delisted = 0
  let restored = 0

  db.transaction((tx) => {
    // The one that counts: this reading and the writes below cannot be separated
    // by anything, so an auction started while the backup was being taken is seen.
    refuseIfFrozen(tx)

    tx.insert(season)
      .values({
        id: data.seasonId,
        label: entrySeason.label,
        datasetVersion: data.version,
        // The two values of this column are the two import paths, not the two
        // places a file can sit: a `.json.gz` in the dataset format came from the
        // pipeline whether it arrived over the network or from a folder. 'xlsx'
        // belongs to T8, which imports a listone spreadsheet directly.
        source: 'github',
        hasFbref: data.hasFbref ? 1 : 0,
        importedAt: now,
      })
      .onConflictDoUpdate({
        target: season.id,
        set: {
          label: entrySeason.label,
          datasetVersion: data.version,
          source: 'github',
          hasFbref: data.hasFbref ? 1 : 0,
          importedAt: now,
        },
      })
      .run()

    for (const team of data.serieATeams) {
      tx.insert(serieATeam)
        .values({ seasonId: data.seasonId, name: team.name, code: team.code })
        .onConflictDoUpdate({
          target: [serieATeam.seasonId, serieATeam.name],
          set: { code: team.code },
        })
        .run()
    }

    const teamId = new Map(
      tx
        .select({ id: serieATeam.id, name: serieATeam.name })
        .from(serieATeam)
        .where(eq(serieATeam.seasonId, data.seasonId))
        .all()
        .map((t) => [t.name, t.id]),
    )

    // Read before writing: after the upserts every incoming player is present and
    // undelisted, so who *was* here is no longer answerable from the table.
    const before = tx
      .select({
        sourceId: player.sourceId,
        id: player.id,
        delistedAt: player.delistedAt,
      })
      .from(player)
      .where(eq(player.seasonId, data.seasonId))
      .all()

    const knownBefore = new Map(before.map((p) => [p.sourceId, p]))

    step(4, 'Giocatori e statistiche')

    for (const p of data.players) {
      const columns = {
        seasonId: data.seasonId,
        sourceId: p.sourceId,
        identityKey: p.identityKey,
        name: p.name,
        nameNormalized: normalizeName(p.name),
        serieATeamId: teamId.get(p.team) as number,
        roleClassic: p.roleClassic,
        qtClassicInitial: p.qtClassicInitial,
        qtClassicCurrent: p.qtClassicCurrent,
        qtMantraInitial: p.qtMantraInitial,
        qtMantraCurrent: p.qtMantraCurrent,
        fvmClassic: p.fvmClassic,
        fvmMantra: p.fvmMantra,
        birthDate: p.birthDate,
        birthYear: p.birthYear,
        penaltyTaker: p.penaltyTaker ? 1 : 0,
        penaltyTakerSource: p.penaltyTakerSource,
        // Back in the listone: the mark goes away, and it must, or a returning
        // player would stay struck through for the rest of the season.
        delistedAt: null,
      }

      tx.insert(player)
        .values(columns)
        .onConflictDoUpdate({ target: [player.seasonId, player.sourceId], set: columns })
        .run()

      const was = knownBefore.get(p.sourceId)
      if (!was) added += 1
      else {
        updated += 1
        if (was.delistedAt !== null) restored += 1
      }
    }

    // Invariant 10. Nothing is deleted here, and nothing may be: purchases,
    // targets and plans point at these rows, and a player sold abroad in
    // September has to stay in the squad of whoever bought him in August.
    const incoming = new Set(data.players.map((p) => p.sourceId))
    for (const p of before) {
      if (incoming.has(p.sourceId) || p.delistedAt !== null) continue
      tx.update(player).set({ delistedAt: now }).where(eq(player.id, p.id)).run()
      delisted += 1
    }

    const idBySourceId = new Map(
      tx
        .select({ id: player.id, sourceId: player.sourceId })
        .from(player)
        .where(eq(player.seasonId, data.seasonId))
        .all()
        .map((p) => [p.sourceId, p.id]),
    )

    // Mantra roles and external ids are rewritten rather than merged: they belong
    // to the listone, and a role dropped between two versions has to disappear
    // instead of lingering.
    //
    // Scoped to the players the dataset carries, and **not** to the season: a
    // delisted player is not in `data.players`, so a season-wide delete would
    // strip him and nothing would put anything back. He would sit in someone's
    // squad with no Mantra role at all, and — since document 4 §7 hangs
    // availability off `player_external_id` and forbids matching names at run
    // time — with no way to ever learn he is injured again.
    const incomingIds = data.players.map((p) => idBySourceId.get(p.sourceId) as number)
    for (const batch of chunked(incomingIds)) {
      tx.delete(playerMantraRole).where(inArray(playerMantraRole.playerId, batch)).run()
      tx.delete(playerExternalId).where(inArray(playerExternalId.playerId, batch)).run()
    }

    for (const p of data.players) {
      const id = idBySourceId.get(p.sourceId) as number

      p.rolesMantra.forEach((role, position) => {
        tx.insert(playerMantraRole)
          .values({ playerId: id, roleCode: role, position })
          .run()
      })

      if (p.externalIds?.fbref !== undefined) {
        tx.insert(playerExternalId)
          .values({ playerId: id, source: 'fbref', externalId: p.externalIds.fbref })
          .run()
      }
      if (p.externalIds?.apiFootball !== undefined) {
        tx.insert(playerExternalId)
          .values({
            playerId: id,
            source: 'apiFootball',
            externalId: String(p.externalIds.apiFootball),
          })
          .run()
      }
    }

    // "Le statistiche si sostituiscono per intero" — scoped to the identities this
    // dataset carries, and not to the whole table. `player_season_stat` has no
    // foreign key on `season_id` by design and holds rows for seasons that have no
    // listone; wiping it would let importing one season empty another one's
    // history, with nothing to notice.
    //
    // The other end of that choice, said out loud: an identity that disappears
    // from `data.stats` entirely keeps whatever it had. Nothing deletes it, and no
    // later import can reach it. That is deliberate — it is what leaves a bought
    // player his history after he drops out of the listone — but it does mean the
    // table only ever grows.
    const statKeys = [...new Set(data.stats.map((s) => s.identityKey))]
    for (const batch of chunked(statKeys)) {
      tx.delete(playerSeasonStat).where(inArray(playerSeasonStat.identityKey, batch)).run()
    }

    for (const s of data.stats) {
      tx.insert(playerSeasonStat)
        .values({
          identityKey: s.identityKey,
          seasonId: s.seasonId,
          teamName: s.team,
          roleClassic: s.roleClassic,
          matchesRated: s.matchesRated,
          avgVote: s.avgVote,
          fantaAvg: s.fantaAvg,
          goals: s.goals,
          goalsConceded: s.goalsConceded,
          assists: s.assists,
          penaltiesTaken: s.penaltiesTaken,
          penaltiesScored: s.penaltiesScored,
          penaltiesMissed: s.penaltiesMissed,
          penaltiesSaved: s.penaltiesSaved,
          yellowCards: s.yellowCards,
          redCards: s.redCards,
          ownGoals: s.ownGoals,
          matchesPlayed: s.matchesPlayed,
          starts: s.starts,
          minutes: s.minutes,
          cleanSheets: s.cleanSheets,
        })
        .run()
    }

    step(5, 'Ricostruzione della ricerca')

    // `player_fts` is contentless, so there is nothing to update in place and no
    // trigger keeping it in step: document 1 §4 rebuilds it at import, which is
    // the only moment reference data changes. 'delete-all' is the command an
    // external-content table understands; a plain DELETE would leave the index
    // pointing at rowids that no longer mean anything.
    tx.run(sql`insert into player_fts(player_fts) values('delete-all')`)

    const everyPlayer = tx
      .select({
        id: player.id,
        name: player.name,
        teamName: serieATeam.name,
      })
      .from(player)
      .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
      .all()

    for (const row of everyPlayer) {
      tx.run(
        sql`insert into player_fts(rowid, name, team_name) values (${row.id}, ${row.name}, ${row.teamName})`,
      )
    }
  })

  return {
    seasonId: data.seasonId,
    version: data.version,
    upToDate: false,
    added,
    updated,
    delisted,
    restored,
    teams: data.serieATeams.length,
    stats: data.stats.length,
    backup,
    hasFbref: data.hasFbref,
    hasExternalIds: data.hasExternalIds,
  }
}
