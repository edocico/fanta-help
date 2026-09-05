import { count, eq, isNull } from 'drizzle-orm'
import type { Channel, EventPayload, EventTopic, Input, Output } from '@shared/contracts'
import type { ClassicRole } from '@shared/domain'
import type { CellValue } from '@shared/sheet'
import type { AppInstance, SeasonStats } from '@shared/types'
import type { Db } from '../db/client'
import {
  assign,
  auctionHistory,
  auctionState,
  closeAuction,
  deletePurchase,
  setTurn,
  startAuction,
  undo,
  updatePurchase,
} from '../services/auction'
import { importDataset } from '../services/dataset-import'
import type { UpdateService } from '../services/update'
import type { SnapshotIoContext } from '../services/snapshot-io'
import { crystallise, listSnapshots, readSnapshot, reopen } from '../services/snapshot'
import {
  exportJson,
  exportXlsx,
  importSnapshot,
  previewSnapshot,
} from '../services/snapshot-io'
import {
  createLeague,
  createTeam,
  deleteLeague,
  deleteTeam,
  listLeagues,
  readLeague,
  reorderTeams,
  updateLeague,
  updateTeam,
} from '../services/league'
import { importListone, previewListone } from '../services/listone-import'
import {
  addPlanItem,
  createPlan,
  deletePlan,
  deleteTarget,
  listPlans,
  listTargets,
  removePlanItem,
  updatePlanItem,
  upsertTarget,
} from '../services/prep'
import { player, playerMantraRole, playerSeasonStat, season, serieATeam } from '../db/schema'

/**
 * The channel → function map, and **nothing that imports `electron`**.
 *
 * That constraint is the whole reason this file is separate from register.ts:
 * coverage.test.ts imports this map to compare it with the contracts, and Vitest
 * runs on plain Node. One `electron` import here — even a transitive one through
 * db/client — and the test dies with NODE_MODULE_VERSION mismatch. Everything
 * the handlers need arrives through the context instead.
 *
 * `Db` is imported as a type only, so it is erased and drags nothing in.
 */

export type HandlerContext = {
  db: Db
  /** Resolved once at startup by the main process, which is allowed to use electron. */
  instance: AppInstance
  /**
   * The two things a service needs and may not do for itself, both supplied from
   * index.ts. They arrive as functions for the same reason `instance` does: their
   * implementations use `electron` and `app.getPath`, and one runtime import of
   * either in this file would kill coverage.test.ts under Node.
   */
  backup: () => Promise<string>
  emit: <T extends EventTopic>(topic: T, payload: EventPayload<T>) => void
  /**
   * L'aggiornamento dell'app, T20. Costruito una volta in `index.ts` e non a
   * ogni chiamata: tiene l'ultimo stato e resta in ascolto dell'updater per
   * tutta la vita del processo.
   *
   * Solo il tipo attraversa questo file. L'implementazione importa
   * `electron-updater`, che importa `electron`, e `coverage.test.ts` carica
   * questo modulo su Node puro.
   */
  update: UpdateService
  /** The native file dialog. Null when it was cancelled. */
  chooseXlsx: () => Promise<string | null>
  /**
   * Opening a workbook needs exceljs, 22 MB of it. Injected rather than imported
   * so this file's runtime graph stays what coverage.test.ts can load on Node in
   * a few hundred milliseconds — the same reason `backup` and `emit` arrive this
   * way, one step further out.
   */
  readGrid: (file: string) => Promise<CellValue[][]>
  /** Il dialogo di salvataggio, col nome proposto. Null se annullato. */
  chooseSaveTo: (name: string) => Promise<string | null>
  /** Il dialogo di apertura per un export JSON. Null se annullato. */
  chooseSnapshot: () => Promise<string | null>
  /** L'altra metà di `readGrid`, e iniettata per la stessa ragione: exceljs. */
  writeGrid: (file: string, sheets: { name: string; rows: CellValue[][] }[]) => Promise<void>
}

/**
 * Il sottoinsieme del contesto che l'export e l'import usano.
 *
 * Passare `ctx` intero funzionerebbe e direbbe meno: questi due non toccano né
 * `emit` né `instance`, e un servizio che riceve tutto è un servizio di cui non
 * si sa cosa fa senza leggerlo.
 */
function io(ctx: HandlerContext): SnapshotIoContext {
  return {
    db: ctx.db,
    instanceUuid: ctx.instance.uuid,
    backup: ctx.backup,
    chooseSaveTo: ctx.chooseSaveTo,
    chooseSnapshot: ctx.chooseSnapshot,
    writeGrid: ctx.writeGrid,
  }
}

type Handler<C extends Channel> = (
  input: Input<C>,
  ctx: HandlerContext,
) => Output<C> | Promise<Output<C>>

export type HandlerMap = { [C in Channel]: Handler<C> }

export const handlers: HandlerMap = {
  'app.instance': (_input, ctx) => ctx.instance,

  /* ------------------------------------------------- aggiornamento, T20 */
  // Quattro righe e nessuna logica: il servizio è uno solo e vive nel contesto,
  // quindi qui non c'è niente da comporre. Il rifiuto «asta in corso» sta
  // dentro `install`, non qui, perché è un'invariante e le invarianti stanno
  // nei servizi — regola 2.
  'update.state': (_input, ctx) => ctx.update.state(),
  'update.check': (_input, ctx) => ctx.update.check(),
  'update.download': (_input, ctx) => ctx.update.download(),
  'update.install': (_input, ctx) => ctx.update.install(),

  'dataset.list': (_input, ctx) => {
    /**
     * Players per role and per season, in one grouped query rather than one per
     * season: the right-hand side of the first coherence check of document 2
     * §4.3. Delisted players are left out — invariant 10 keeps them in the table
     * and nobody can buy one.
     */
    const counts = new Map<string, Record<ClassicRole, number>>()
    for (const row of ctx.db
      .select({ seasonId: player.seasonId, role: player.roleClassic, n: count() })
      .from(player)
      .where(isNull(player.delistedAt))
      .groupBy(player.seasonId, player.roleClassic)
      .all()) {
      const forSeason = counts.get(row.seasonId) ?? { P: 0, D: 0, C: 0, A: 0 }
      forSeason[row.role as ClassicRole] = row.n
      counts.set(row.seasonId, forSeason)
    }

    return ctx.db
      .select()
      .from(season)
      // By season, not by rowid. Callers take the last one as "the most recent"
      // — document 2 §4.4 for the players view, the onboarding for its proposal
      // — and insertion order would answer with whichever was imported last,
      // which is 2023-24 for anyone who filled in a past season afterwards.
      .orderBy(season.id)
      .all()
      .map((s) => ({
        id: s.id,
        label: s.label,
        datasetVersion: s.datasetVersion,
        source: s.source,
        hasFbref: s.hasFbref === 1,
        importedAt: s.importedAt,
        playersByRole: counts.get(s.id) ?? { P: 0, D: 0, C: 0, A: 0 },
      }))
  },

  /* --------------------------------------------------------------- league */

  'league.list': (_input, ctx) => listLeagues(ctx.db),
  'league.get': (input, ctx) => readLeague(ctx.db, input.id),
  'league.create': (input, ctx) => createLeague(input, ctx.db),
  'league.update': (input, ctx) => updateLeague(input, ctx.db),
  'league.delete': (input, ctx) => deleteLeague(input, ctx.db),

  'team.create': (input, ctx) => createTeam(input, ctx.db),
  'team.update': (input, ctx) => updateTeam(input, ctx.db),
  'team.delete': (input, ctx) => deleteTeam(input, ctx.db),
  'team.reorder': (input, ctx) => reorderTeams(input, ctx.db),

  'dataset.import': (input, ctx) =>
    importDataset(input, {
      db: ctx.db,
      backup: ctx.backup,
      emit: (progress) => ctx.emit('dataset.progress', progress),
    }),

  'listone.pick': async (_input, ctx) => {
    const filePath = await ctx.chooseXlsx()
    return filePath === null ? null : { filePath }
  },

  'listone.preview': (input, ctx) =>
    previewListone(input, { db: ctx.db, readGrid: ctx.readGrid, backup: ctx.backup }),

  'listone.import': (input, ctx) =>
    importListone(input, { db: ctx.db, readGrid: ctx.readGrid, backup: ctx.backup }),

  'target.list': (input, ctx) => listTargets(ctx.db, input.leagueId),
  'target.upsert': (input, ctx) => upsertTarget(input, ctx.db),
  'target.delete': (input, ctx) => deleteTarget(input, ctx.db),

  'plan.list': (input, ctx) => listPlans(ctx.db, input.leagueId),
  'plan.create': (input, ctx) => createPlan(input, ctx.db),
  'plan.delete': (input, ctx) => deletePlan(input, ctx.db),
  'plan.addItem': (input, ctx) => addPlanItem(input, ctx.db),
  'plan.updateItem': (input, ctx) => updatePlanItem(input, ctx.db),
  'plan.removeItem': (input, ctx) => removePlanItem(input, ctx.db),

  /* -------------------------------------------------------------- auction */

  'auction.state': (input, ctx) => auctionState(ctx.db, input.leagueId),
  'auction.start': (input, ctx) => startAuction(input, ctx.db, ctx.instance.uuid),
  'auction.assign': (input, ctx) => assign(input, ctx.db, ctx.instance.uuid),
  'auction.undo': (input, ctx) => undo(input, ctx.db, ctx.instance.uuid),
  'auction.setTurn': (input, ctx) => setTurn(input, ctx.db, ctx.instance.uuid),
  'auction.close': (input, ctx) => closeAuction(input, ctx.db, ctx.instance.uuid),
  'auction.history': (input, ctx) => auctionHistory(ctx.db, input.leagueId),
  'purchase.update': (input, ctx) => updatePurchase(input, ctx.db, ctx.instance.uuid),
  'purchase.delete': (input, ctx) => deletePurchase(input, ctx.db, ctx.instance.uuid),
  'snapshot.list': (input, ctx) => listSnapshots(ctx.db, input.leagueId),
  'snapshot.get': (input, ctx) => readSnapshot(ctx.db, input.leagueId, input.version),
  'snapshot.create': (input, ctx) => crystallise(input, ctx.db, ctx.instance.uuid),
  'snapshot.reopen': (input, ctx) => reopen(input, ctx.db, ctx.instance.uuid),
  'snapshot.exportJson': (input, ctx) => exportJson(input, io(ctx)),
  'snapshot.exportXlsx': (input, ctx) => exportXlsx(input, io(ctx)),
  'snapshot.pick': async (_input, ctx) => {
    const filePath = await ctx.chooseSnapshot()
    return filePath === null ? null : { filePath }
  },
  'snapshot.preview': (input, ctx) => previewSnapshot(input, io(ctx)),
  'snapshot.import': (input, ctx) => importSnapshot(input, io(ctx)),

  'player.list': (input, ctx) => {
    const info = ctx.db
      .select({ hasFbref: season.hasFbref })
      .from(season)
      .where(eq(season.id, input.seasonId))
      .get()

    const rows = ctx.db
      .select({
        id: player.id,
        identityKey: player.identityKey,
        name: player.name,
        fullName: player.fullName,
        roleClassic: player.roleClassic,
        teamName: serieATeam.name,
        teamCode: serieATeam.code,
        qtClassicCurrent: player.qtClassicCurrent,
        qtClassicInitial: player.qtClassicInitial,
        fvmClassic: player.fvmClassic,
        penaltyTaker: player.penaltyTaker,
        delistedAt: player.delistedAt,
      })
      .from(player)
      .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
      .where(eq(player.seasonId, input.seasonId))
      .all()

    /**
     * Every season of history, in one query, grouped by identity here.
     *
     * `player_season_stat` is keyed by `identity_key` and not by `player.id`,
     * deliberately: it covers seasons that have no row in `season` at all, which
     * is why it has no foreign key. So the join happens on the key, and a player
     * carries the past of whoever the reconciliation decided he is.
     */
    const keys = new Set(rows.map((r) => r.identityKey))
    const history = new Map<string, Record<string, SeasonStats>>()
    const seasons = new Set<string>()

    for (const stat of ctx.db.select().from(playerSeasonStat).all()) {
      if (!keys.has(stat.identityKey)) continue
      seasons.add(stat.seasonId)
      const forPlayer: Record<string, SeasonStats> = history.get(stat.identityKey) ?? {}
      forPlayer[stat.seasonId] = {
        matchesRated: stat.matchesRated,
        avgVote: stat.avgVote,
        fantaAvg: stat.fantaAvg,
        goalsConceded: stat.goalsConceded,
        yellowCards: stat.yellowCards,
        redCards: stat.redCards,
        ownGoals: stat.ownGoals,
        matchesPlayed: stat.matchesPlayed,
        starts: stat.starts,
        minutes: stat.minutes,
        cleanSheets: stat.cleanSheets,
      }
      history.set(stat.identityKey, forPlayer)
    }

    const statsSeasons = [...seasons].sort()
    // The last one strictly before the season being viewed. Falls back to the
    // most recent there is, so a database holding only the current season still
    // shows numbers rather than an empty table.
    const completed = statsSeasons.filter((id) => id < input.seasonId)
    const defaultStatsSeason = completed.at(-1) ?? statsSeasons.at(-1) ?? null

    // One query for the badges rather than one per player, grouped here.
    const mantra = new Map<number, string[]>()
    for (const row of ctx.db
      .select({ playerId: playerMantraRole.playerId, roleCode: playerMantraRole.roleCode })
      .from(playerMantraRole)
      .innerJoin(player, eq(player.id, playerMantraRole.playerId))
      .where(eq(player.seasonId, input.seasonId))
      .orderBy(playerMantraRole.position)
      .all()) {
      const roles = mantra.get(row.playerId)
      if (roles) roles.push(row.roleCode)
      else mantra.set(row.playerId, [row.roleCode])
    }

    return {
      seasonId: input.seasonId,
      hasFbref: info?.hasFbref === 1,
      statsSeasons,
      defaultStatsSeason,
      players: rows.map((row) => ({
        id: row.id,
        name: row.name,
        fullName: row.fullName,
        roleClassic: row.roleClassic,
        rolesMantra: mantra.get(row.id) ?? [],
        teamName: row.teamName,
        teamCode: row.teamCode,
        qtClassicCurrent: row.qtClassicCurrent,
        qtClassicInitial: row.qtClassicInitial,
        fvmClassic: row.fvmClassic,
        penaltyTaker: row.penaltyTaker === 1,
        delisted: row.delistedAt !== null,
        stats: history.get(row.identityKey) ?? {},
      })),
    }
  },
}
