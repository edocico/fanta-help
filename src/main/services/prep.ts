import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Input } from '@shared/contracts'
import { ROLE_LABELS, ROLE_LABELS_ONE, type ClassicRole } from '@shared/domain'
import { raise } from '@shared/errors'
import type { PlanDetail, TargetRow } from '@shared/types'
import type { Db } from '../db/client'
import {
  league,
  leagueSlot,
  plan,
  planItem,
  player,
  season,
  serieATeam,
  target,
} from '../db/schema'

/**
 * Objectives and plans, T12 — the two halves of document 2 §4.6 and §4.7.
 *
 * One file because they share every guard they have. Both hang off a league,
 * both point at a player, and both have to answer the same question the schema
 * does not: whether that player belongs to the league's season.
 *
 * What they do *not* share with T11 is a status gate. Invariant 13 names the
 * three tables a crystallised league freezes — `purchase`, `fanta_team`,
 * `league_slot` — and neither `target` nor `plan` is among them. That is read
 * literally here: objectives are notes taken while preparing, they are not the
 * result, and a snapshot keeps its own copy of everything anyway. Inventing a
 * fourth frozen table would be inventing an invariant.
 */

type Reader = Pick<Db, 'select'>

/* -------------------------------------------------------------- guards */

/** The league a call names, with the season its players must come from. */
function requireLeague(on: Reader, id: number): { id: number; seasonId: string; budget: number } {
  const row = on
    .select({ id: league.id, seasonId: league.seasonId, budget: league.budget })
    .from(league)
    .where(eq(league.id, id))
    .get()
  if (!row) raise('LEAGUE_MISSING')
  return row
}

/**
 * Invariant 7 applied outside the auction: the player has to be in the league's
 * own season.
 *
 * `target.player_id` and `plan_item.player_id` both point at `player`, and
 * `player` spans every season imported — so a stale renderer holding the 2025-26
 * listone can hand this a player who exists, passes the foreign key, and belongs
 * to another year. The board would then show a tile the auction can never buy.
 *
 * Returns the role, because both callers need it and neither may take it from
 * the request: document 1 §3 says the roster is governed by the Classic role,
 * and a caller that could name the role could file a goalkeeper as a striker.
 */
function requirePlayerInSeason(
  on: Reader,
  playerId: number,
  seasonId: string,
): { name: string; roleClassic: ClassicRole } {
  const row = on
    .select({ name: player.name, roleClassic: player.roleClassic })
    .from(player)
    .where(and(eq(player.id, playerId), eq(player.seasonId, seasonId)))
    .get()
  if (!row) {
    const label = on.select({ label: season.label }).from(season).where(eq(season.id, seasonId)).get()
    raise('PLAYER_WRONG_SEASON', { season: label?.label ?? seasonId })
  }
  return { name: row.name, roleClassic: row.roleClassic as ClassicRole }
}

/* ------------------------------------------------------------- reading */

/**
 * The board of a league, tiles included.
 *
 * The player's columns are joined in here rather than looked up in the renderer's
 * listone cache: the board must draw before anyone has opened Giocatori.
 */
export function listTargets(on: Reader, leagueId: number): TargetRow[] {
  return on
    .select({
      playerId: target.playerId,
      name: player.name,
      teamName: serieATeam.name,
      teamCode: serieATeam.code,
      roleClassic: player.roleClassic,
      qtClassicCurrent: player.qtClassicCurrent,
      tier: target.tier,
      maxPrice: target.maxPrice,
      rating: target.rating,
      note: target.note,
      priority: target.priority,
    })
    .from(target)
    .innerJoin(player, eq(target.playerId, player.id))
    .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
    .where(eq(target.leagueId, leagueId))
    // Inside a cell of the board, the order they were marked in.
    .orderBy(target.priority)
    .all()
    .map((row) => ({ ...row, roleClassic: row.roleClassic as ClassicRole }))
}

/**
 * Every plan of a league with its cells, which is what the comparison of
 * document 2 §4.7 needs — "due piani si possono affiancare".
 *
 * Two queries and not one per plan: a league has a handful of plans and each
 * holds at most a roster, so the whole thing is a few hundred rows at worst.
 */
export function listPlans(on: Reader, leagueId: number): PlanDetail[] {
  const plans = on
    .select()
    .from(plan)
    .where(eq(plan.leagueId, leagueId))
    .orderBy(plan.createdAt)
    .all()
  if (plans.length === 0) return []

  const items = on
    .select({
      planId: planItem.planId,
      playerId: planItem.playerId,
      name: player.name,
      teamName: serieATeam.name,
      teamCode: serieATeam.code,
      slotRole: planItem.slotRole,
      estPrice: planItem.estPrice,
      qtClassicCurrent: player.qtClassicCurrent,
    })
    .from(planItem)
    .innerJoin(player, eq(planItem.playerId, player.id))
    .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
    .where(
      inArray(
        planItem.planId,
        plans.map((p) => p.id),
      ),
    )
    /**
     * Dearest first inside a role, then by id.
     *
     * `plan_item` has no order column — its primary key is `(plan_id,
     * player_id)` — so an unordered select would come back in whatever order
     * SQLite finds convenient, and the grid would reshuffle itself between two
     * renders of the same plan. Price is the order a roster is read in anyway:
     * the slot that costs 120 is the one the plan stands or falls on.
     */
    .orderBy(desc(planItem.estPrice), planItem.playerId)
    .all()

  return plans.map((p) => ({
    id: p.id,
    leagueId: p.leagueId,
    name: p.name,
    createdAt: p.createdAt,
    // Spelled out rather than spread-minus-planId: the contract has seven fields
    // and listing them is how a field added to the query without being added to
    // `planItemRow` fails to compile instead of travelling unannounced.
    items: items
      .filter((item) => item.planId === p.id)
      .map((item) => ({
        playerId: item.playerId,
        name: item.name,
        teamName: item.teamName,
        teamCode: item.teamCode,
        slotRole: item.slotRole as ClassicRole,
        estPrice: item.estPrice,
        qtClassicCurrent: item.qtClassicCurrent,
      })),
  }))
}

/* ------------------------------------------------------- objectives */

/**
 * Creates or updates in one call, which is what lets the star of document 2 §4.4
 * be a single gesture on a row that may or may not already be marked.
 *
 * Absent fields are left alone and null clears them — the contract says why. The
 * priority is only ever set on creation: an edit from the detail panel must not
 * move a tile the board has already been arranged around.
 */
export function upsertTarget(input: Input<'target.upsert'>, db: Db): TargetRow[] {
  return db.transaction((tx) => {
    const found = requireLeague(tx, input.leagueId)
    requirePlayerInSeason(tx, input.playerId, found.seasonId)

    const existing = tx
      .select({ playerId: target.playerId })
      .from(target)
      .where(and(eq(target.leagueId, input.leagueId), eq(target.playerId, input.playerId)))
      .get()

    const patch = {
      ...(input.tier !== undefined && { tier: input.tier }),
      ...(input.maxPrice !== undefined && { maxPrice: input.maxPrice }),
      ...(input.rating !== undefined && { rating: input.rating }),
      ...(input.note !== undefined && { note: input.note }),
    }

    if (existing) {
      // Nothing to write is not an error: the star was pressed on a player who is
      // already a target, and the answer is the board as it stands.
      if (Object.keys(patch).length > 0) {
        tx.update(target)
          .set(patch)
          .where(and(eq(target.leagueId, input.leagueId), eq(target.playerId, input.playerId)))
          .run()
      }
    } else {
      const last = tx
        .select({ n: sql<number | null>`max(${target.priority})` })
        .from(target)
        .where(eq(target.leagueId, input.leagueId))
        .get()
      tx.insert(target)
        .values({
          leagueId: input.leagueId,
          playerId: input.playerId,
          tier: input.tier ?? null,
          maxPrice: input.maxPrice ?? null,
          rating: input.rating ?? null,
          note: input.note ?? null,
          priority: (last?.n ?? -1) + 1,
        })
        .run()
    }

    return listTargets(tx, input.leagueId)
  })
}

export function deleteTarget(input: Input<'target.delete'>, db: Db): TargetRow[] {
  return db.transaction((tx) => {
    requireLeague(tx, input.leagueId)
    tx.delete(target)
      .where(and(eq(target.leagueId, input.leagueId), eq(target.playerId, input.playerId)))
      .run()
    return listTargets(tx, input.leagueId)
  })
}

/* ------------------------------------------------------------- plans */

export function createPlan(input: Input<'plan.create'>, db: Db): PlanDetail[] {
  return db.transaction((tx) => {
    requireLeague(tx, input.leagueId)
    tx.insert(plan)
      .values({ leagueId: input.leagueId, name: input.name, createdAt: Date.now() })
      .run()
    return listPlans(tx, input.leagueId)
  })
}

export function deletePlan(input: Input<'plan.delete'>, db: Db): PlanDetail[] {
  return db.transaction((tx) => {
    const row = tx
      .select({ leagueId: plan.leagueId })
      .from(plan)
      .where(eq(plan.id, input.id))
      .get()
    if (!row) raise('PLAN_MISSING')

    tx.delete(plan).where(eq(plan.id, input.id)).run()
    return listPlans(tx, row.leagueId)
  })
}

/**
 * One cell filled.
 *
 * Three refusals, and each of them protects something the schema cannot: the
 * player belongs to the league's season, he is not already in this plan — the
 * primary key would catch that as `UNKNOWN` — and the role has a cell free.
 *
 * The last one is a cap on *creating* an overflow, not on having one: lowering
 * the slots of a plan already built leaves items beyond the grid, invariant 16
 * allows exactly that in `pre_auction`, and `planCells` draws them apart instead
 * of dropping them.
 */
export function addPlanItem(input: Input<'plan.addItem'>, db: Db): PlanDetail[] {
  return db.transaction((tx) => {
    const row = tx
      .select({ leagueId: plan.leagueId })
      .from(plan)
      .where(eq(plan.id, input.planId))
      .get()
    if (!row) raise('PLAN_MISSING')

    const found = requireLeague(tx, row.leagueId)
    const chosen = requirePlayerInSeason(tx, input.playerId, found.seasonId)

    const already = tx
      .select({ playerId: planItem.playerId })
      .from(planItem)
      .where(and(eq(planItem.planId, input.planId), eq(planItem.playerId, input.playerId)))
      .get()
    if (already) raise('PLAN_ITEM_EXISTS', { name: chosen.name })

    const cap =
      tx
        .select({ slots: leagueSlot.slots })
        .from(leagueSlot)
        .where(
          and(
            eq(leagueSlot.leagueId, row.leagueId),
            eq(leagueSlot.roleCode, chosen.roleClassic),
          ),
        )
        .get()?.slots ?? 0

    const taken = tx
      .select({ playerId: planItem.playerId })
      .from(planItem)
      .where(and(eq(planItem.planId, input.planId), eq(planItem.slotRole, chosen.roleClassic)))
      .all().length
    if (taken >= cap) {
      raise('PLAN_ROLE_FULL', {
        n: taken,
        one: ROLE_LABELS_ONE[chosen.roleClassic],
        many: ROLE_LABELS[chosen.roleClassic],
      })
    }

    tx.insert(planItem)
      .values({
        planId: input.planId,
        playerId: input.playerId,
        estPrice: input.estPrice,
        slotRole: chosen.roleClassic,
      })
      .run()

    return listPlans(tx, row.leagueId)
  })
}

/**
 * A cell re-priced.
 *
 * Refuses a cell that is not there rather than writing nothing and answering as
 * if it had: the only way to reach this with a player who is not in the plan is a
 * renderer holding a grid someone else has already emptied, and a silent no-op
 * would leave that grid on screen showing the price it just typed.
 */
export function updatePlanItem(input: Input<'plan.updateItem'>, db: Db): PlanDetail[] {
  return db.transaction((tx) => {
    const row = tx
      .select({ leagueId: plan.leagueId })
      .from(plan)
      .where(eq(plan.id, input.planId))
      .get()
    if (!row) raise('PLAN_MISSING')

    const cell = tx
      .select({ playerId: planItem.playerId })
      .from(planItem)
      .where(and(eq(planItem.planId, input.planId), eq(planItem.playerId, input.playerId)))
      .get()
    if (!cell) raise('PLAN_ITEM_MISSING')

    tx.update(planItem)
      .set({ estPrice: input.estPrice })
      .where(and(eq(planItem.planId, input.planId), eq(planItem.playerId, input.playerId)))
      .run()

    return listPlans(tx, row.leagueId)
  })
}

export function removePlanItem(input: Input<'plan.removeItem'>, db: Db): PlanDetail[] {
  return db.transaction((tx) => {
    const row = tx
      .select({ leagueId: plan.leagueId })
      .from(plan)
      .where(eq(plan.id, input.planId))
      .get()
    if (!row) raise('PLAN_MISSING')

    tx.delete(planItem)
      .where(and(eq(planItem.planId, input.planId), eq(planItem.playerId, input.playerId)))
      .run()
    return listPlans(tx, row.leagueId)
  })
}
