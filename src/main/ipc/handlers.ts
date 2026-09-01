import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Channel, EventPayload, EventTopic, Input, Output } from '@shared/contracts'
import { normalizeName } from '@shared/domain'
import type { AppInstance } from '@shared/types'
import type { Db } from '../db/client'
import { importDataset } from '../services/dataset-import'
import { player, playerMantraRole, purchase, season, serieATeam } from '../db/schema'

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
}

type Handler<C extends Channel> = (
  input: Input<C>,
  ctx: HandlerContext,
) => Output<C> | Promise<Output<C>>

export type HandlerMap = { [C in Channel]: Handler<C> }

export const handlers: HandlerMap = {
  'app.instance': (_input, ctx) => ctx.instance,

  'dataset.list': (_input, ctx) =>
    ctx.db
      .select()
      .from(season)
      .all()
      .map((s) => ({
        id: s.id,
        label: s.label,
        datasetVersion: s.datasetVersion,
        source: s.source,
        hasFbref: s.hasFbref === 1,
        importedAt: s.importedAt,
      })),

  'dataset.import': (input, ctx) =>
    importDataset(input, {
      db: ctx.db,
      backup: ctx.backup,
      emit: (progress) => ctx.emit('dataset.progress', progress),
    }),

  'player.list': (input, ctx) => {
    const where = [eq(player.seasonId, input.seasonId)]

    if (input.role) where.push(eq(player.roleClassic, input.role))
    if (input.serieATeamId) where.push(eq(player.serieATeamId, input.serieATeamId))
    if (input.search) {
      // LIKE reads % and _ as wildcards. Unescaped, typing a single underscore
      // returns the entire season. drizzle's like() has no ESCAPE clause.
      const pattern = `%${normalizeName(input.search).replace(/[\\%_]/g, '\\$&')}%`
      where.push(sql`${player.nameNormalized} like ${pattern} escape '\\'`)
    }
    if (input.mantraRole) {
      where.push(
        inArray(
          player.id,
          ctx.db
            .select({ id: playerMantraRole.playerId })
            .from(playerMantraRole)
            .where(eq(playerMantraRole.roleCode, input.mantraRole)),
        ),
      )
    }

    // `leagueId` exists to mark the players already bought. With no league the
    // join matches nothing and every row comes back unowned.
    const rows = ctx.db
      .select({
        id: player.id,
        name: player.name,
        roleClassic: player.roleClassic,
        teamName: serieATeam.name,
        qtClassicCurrent: player.qtClassicCurrent,
        fvmClassic: player.fvmClassic,
        purchaseId: purchase.id,
      })
      .from(player)
      .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
      .leftJoin(
        purchase,
        and(eq(purchase.playerId, player.id), eq(purchase.leagueId, input.leagueId ?? -1)),
      )
      .where(and(...where))
      .all()

    return rows.map(({ purchaseId, ...row }) => ({ ...row, owned: purchaseId !== null }))
  },
}
