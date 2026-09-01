import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Input } from '@shared/contracts'
import {
  canStartAuction,
  canTransition,
  checkPurchase,
  freeSlots,
  frozen,
  maxBid,
  ROLE_LABELS,
  ROLE_LABELS_ONE,
  totalSlots,
  type ClassicRole,
  type RosterState,
  type Violation,
} from '@shared/domain'
import { raise } from '@shared/errors'
import type { AuctionLogEntry, AuctionState } from '@shared/types'
import type { Db } from '../db/client'
import {
  auctionLog,
  fantaTeam,
  league,
  leagueSlot,
  player,
  purchase,
  serieATeam,
  target,
} from '../db/schema'

/**
 * The auction, T13. No interface: that is T14.
 *
 * This file decides no rule. The rules are the pure functions of
 * `shared/domain.ts` — `maxBid`, `checkPurchase`, `canStartAuction` — written
 * before it together with their tests, which is the order document 6 §7 imposes:
 * "scrivere il servizio prima significa scoprire le regole mentre si scrive il
 * codice che le applica, che è il modo più affidabile di scrivere regole
 * sbagliate". What is here is the I/O around them: read three numbers, ask,
 * write.
 *
 * The shape is the canonical one of document 3 §5. Every write is a transaction
 * and every check happens inside it rather than before: `ipcMain.handle` does not
 * serialise invokes, and two quick clicks on the same player interleave.
 */

type Reader = Pick<Db, 'select'>
type Writer = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

/* -------------------------------------------------------------- reading */

function slotsOf(on: Reader, leagueId: number): Record<ClassicRole, number> {
  const slots: Record<ClassicRole, number> = { P: 0, D: 0, C: 0, A: 0 }
  for (const row of on.select().from(leagueSlot).where(eq(leagueSlot.leagueId, leagueId)).all()) {
    slots[row.roleCode as ClassicRole] = row.slots
  }
  return slots
}

/**
 * The three numbers the invariants ask for, for one team.
 *
 * This is what document 6 §3 calls `readRosterState`: all of `checkPurchase`'s
 * I/O lives here, and the pure function never learns that a database exists.
 */
function rosterState(
  on: Reader,
  teamId: number,
  budget: number,
  slots: Record<ClassicRole, number>,
): RosterState {
  const bought = on
    .select({ slotRole: purchase.slotRole, price: purchase.price })
    .from(purchase)
    .where(eq(purchase.fantaTeamId, teamId))
    .all()

  const filled: Record<ClassicRole, number> = { P: 0, D: 0, C: 0, A: 0 }
  let spent = 0
  for (const row of bought) {
    filled[row.slotRole as ClassicRole] += 1
    spent += row.price
  }

  return { credits: budget - spent, filled, slots }
}

/**
 * Everything the screen of document 2 §4.8 draws, in one answer.
 *
 * Every mutation replies with this, as in T11 and T12: one purchase changes the
 * rose grid for the buying team *and* the count in the header *and* the turn in a
 * draft *and* the list of free objectives, and a renderer patching its own copy
 * would drift from the database on the first refusal. It is at most ten teams
 * with twenty-five purchases each.
 */
export function auctionState(on: Reader, leagueId: number): AuctionState | null {
  const row = on.select().from(league).where(eq(league.id, leagueId)).get()
  if (!row) return null

  const slots = slotsOf(on, leagueId)
  const teams = on
    .select()
    .from(fantaTeam)
    .where(eq(fantaTeam.leagueId, leagueId))
    .orderBy(fantaTeam.orderIndex)
    .all()

  const bought = on
    .select({
      id: purchase.id,
      fantaTeamId: purchase.fantaTeamId,
      playerId: purchase.playerId,
      price: purchase.price,
      slotRole: purchase.slotRole,
      sequence: purchase.sequence,
      name: player.name,
      teamCode: serieATeam.code,
      teamName: serieATeam.name,
    })
    .from(purchase)
    .innerJoin(player, eq(purchase.playerId, player.id))
    .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
    .where(eq(purchase.leagueId, leagueId))
    .orderBy(purchase.sequence)
    .all()

  const rosters = teams.map((team) => {
    const mine = bought.filter((p) => p.fantaTeamId === team.id)
    const state = rosterState(on, team.id, row.budget, slots)
    return {
      id: team.id,
      uuid: team.uuid,
      name: team.name,
      color: team.color,
      isMine: team.isMine === 1,
      orderIndex: team.orderIndex,
      spent: row.budget - state.credits,
      credits: state.credits,
      maxBid: maxBid(state, row.minBid),
      filled: state.filled,
      /**
       * "Rosa completa → la squadra sparisce dal selettore", document 2 §7.
       *
       * Free slots at zero, and **not** maximum bid at zero: that is also zero
       * for a team with empty slots and no credits left, which is a team that is
       * stuck, not a team that is done. Dropping it from the selector for the
       * same reason would say something false at exactly the wrong moment.
       */
      complete: freeSlots(state) === 0,
      roster: mine.map((p) => ({
        purchaseId: p.id,
        playerId: p.playerId,
        name: p.name,
        teamCode: p.teamCode ?? p.teamName,
        slotRole: p.slotRole as ClassicRole,
        price: p.price,
        sequence: p.sequence,
      })),
    }
  })

  /**
   * "I tuoi target ancora non assegnati", document 2 §4.8: whoever has been
   * bought is gone from the list — by anyone, which is the point of the panel.
   * Ordered by tier and then rating, as the same line asks, with the ones nobody
   * placed at the bottom.
   */
  const taken = new Set(bought.map((p) => p.playerId))
  const targetsFree = on
    .select({
      playerId: target.playerId,
      name: player.name,
      roleClassic: player.roleClassic,
      teamCode: serieATeam.code,
      teamName: serieATeam.name,
      tier: target.tier,
      rating: target.rating,
      maxPrice: target.maxPrice,
    })
    .from(target)
    .innerJoin(player, eq(target.playerId, player.id))
    .innerJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
    .where(eq(target.leagueId, leagueId))
    .all()
    .filter((t) => !taken.has(t.playerId))
    .map((t) => ({
      playerId: t.playerId,
      name: t.name,
      roleClassic: t.roleClassic as ClassicRole,
      teamCode: t.teamCode ?? t.teamName,
      tier: t.tier,
      rating: t.rating,
      maxPrice: t.maxPrice,
    }))
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || (b.rating ?? 0) - (a.rating ?? 0))

  const last = bought.at(-1) ?? null

  return {
    league: {
      id: row.id,
      name: row.name,
      seasonId: row.seasonId,
      mode: row.mode,
      auctionFormat: row.auctionFormat,
      budget: row.budget,
      minBid: row.minBid,
      status: row.status,
    },
    slots,
    currentTurnTeamId: row.currentTurnTeamId,
    slotsTotal: teams.length * totalSlots(slots),
    assigned: bought.length,
    teams: rosters,
    targetsFree,
    lastPurchase:
      last === null
        ? null
        : {
            purchaseId: last.id,
            playerId: last.playerId,
            name: last.name,
            fantaTeamId: last.fantaTeamId,
            teamName: teams.find((t) => t.id === last.fantaTeamId)?.name ?? '',
            price: last.price,
          },
  }
}

/** The register of document 1 §3: append-only, and not the source of truth. */
export function auctionHistory(on: Reader, leagueId: number): AuctionLogEntry[] {
  return on
    .select({
      id: auctionLog.id,
      phase: auctionLog.phase,
      action: auctionLog.action,
      payload: auctionLog.payload,
      createdAt: auctionLog.createdAt,
    })
    .from(auctionLog)
    .where(eq(auctionLog.leagueId, leagueId))
    .orderBy(desc(auctionLog.createdAt), desc(auctionLog.id))
    .all()
}

/* --------------------------------------------------------------- guards */

type LeagueRow = {
  id: number
  status: 'setup' | 'pre_auction' | 'auction' | 'review' | 'closed'
  seasonId: string
  budget: number
  minBid: number
  auctionFormat: 'call' | 'draft'
  currentTurnTeamId: number | null
}

function requireLeague(on: Reader, id: number): LeagueRow {
  const row = on
    .select({
      id: league.id,
      status: league.status,
      seasonId: league.seasonId,
      budget: league.budget,
      minBid: league.minBid,
      auctionFormat: league.auctionFormat,
      currentTurnTeamId: league.currentTurnTeamId,
    })
    .from(league)
    .where(eq(league.id, id))
    .get()
  if (!row) raise('LEAGUE_MISSING')
  return row
}

/** An open auction is what assigning, undoing and passing the turn presume. */
function requireOpenAuction(row: LeagueRow): void {
  if (frozen(row.status)) raise('LEAGUE_FROZEN')
  if (row.status !== 'auction') raise('AUCTION_NOT_OPEN')
}

function teamOf(on: Reader, leagueId: number, teamId: number): { id: number; name: string } {
  const row = on
    .select({ id: fantaTeam.id, name: fantaTeam.name })
    .from(fantaTeam)
    .where(and(eq(fantaTeam.id, teamId), eq(fantaTeam.leagueId, leagueId)))
    .get()
  if (!row) raise('TEAM_MISSING')
  return row
}

/**
 * From violation to refusal, with the numbers in the right places.
 *
 * A `switch` and not a map: every code wants different parameters, and the
 * compiler checks them case by case against the discriminated union. A code
 * added to `Violation` without a branch here fails to compile, instead of
 * reaching the renderer as `UNKNOWN`.
 */
function refuse(violation: Violation, team: string, role: ClassicRole): never {
  switch (violation.code) {
    case 'BELOW_MIN_BID':
      raise('BELOW_MIN_BID', { n: violation.detail.n })
      break
    case 'ROLE_SLOTS_FULL':
      raise('ROLE_SLOTS_FULL', {
        team,
        n: violation.detail.n,
        one: ROLE_LABELS_ONE[role],
        many: ROLE_LABELS[role],
      })
      break
    case 'INSUFFICIENT_CREDITS':
      raise('INSUFFICIENT_CREDITS', { team, n: violation.detail.n })
      break
    case 'EXCEEDS_MAX_BID':
      raise('EXCEEDS_MAX_BID', {
        team,
        max: violation.detail.max,
        n: violation.detail.keep,
      })
  }
}

function log(
  on: Writer,
  leagueId: number,
  action: string,
  payload: unknown,
  actorUuid: string,
): void {
  on.insert(auctionLog)
    .values({
      leagueId,
      phase: 'auction',
      action,
      payload: JSON.stringify(payload),
      actorUuid,
      createdAt: Date.now(),
    })
    .run()
}

/* --------------------------------------------------------------- writing */

/**
 * Invariant 8: an auction opens with at least two teams and the slots set.
 *
 * The turn starts on the first team in the order, which is the one the wizard
 * settled by dragging the rows. In the call format it stays there until somebody
 * moves it by hand (document 2 §9); in a draft it advances on every assignment.
 */
export function startAuction(
  input: Input<'auction.start'>,
  db: Db,
  actorUuid: string,
): AuctionState {
  return db.transaction((tx) => {
    const row = requireLeague(tx, input.leagueId)
    if (frozen(row.status)) raise('LEAGUE_FROZEN')
    if (!canTransition(row.status, 'auction')) raise('AUCTION_ALREADY_OPEN')

    const teams = tx
      .select({ id: fantaTeam.id })
      .from(fantaTeam)
      .where(eq(fantaTeam.leagueId, input.leagueId))
      .orderBy(fantaTeam.orderIndex)
      .all()
    const slots = slotsOf(tx, input.leagueId)

    if (teams.length < 2) raise('TOO_FEW_TEAMS')
    if (!canStartAuction({ teams: teams.length, slots })) raise('LEAGUE_SLOTS_EMPTY')

    tx.update(league)
      .set({
        status: 'auction',
        currentTurnTeamId: teams[0].id,
        updatedAt: Date.now(),
      })
      .where(eq(league.id, input.leagueId))
      .run()

    log(tx, input.leagueId, 'auction.start', { teams: teams.length }, actorUuid)
    return auctionState(tx, input.leagueId) as AuctionState
  })
}

/**
 * The assignment: the canonical transaction of document 3 §5.
 *
 * The order of the checks is not incidental. First the structural invariants —
 * the league exists and its auction is open, the player belongs to this season
 * (7) and to nobody yet (1) — and then the ones of merit, which are the only
 * ones revision will ever downgrade. `slot_role` does not come from the request:
 * it is read off the player, which is invariant 6 made impossible to break
 * rather than checked.
 */
export function assign(input: Input<'auction.assign'>, db: Db, actorUuid: string): AuctionState {
  return db.transaction((tx) => {
    const row = requireLeague(tx, input.leagueId)
    requireOpenAuction(row)

    const team = teamOf(tx, input.leagueId, input.fantaTeamId)

    // Invariant 7: the player belongs to this league's listone.
    const chosen = tx
      .select({ id: player.id, name: player.name, roleClassic: player.roleClassic })
      .from(player)
      .where(and(eq(player.id, input.playerId), eq(player.seasonId, row.seasonId)))
      .get()
    if (!chosen) raise('PLAYER_WRONG_SEASON', { season: row.seasonId })

    /**
     * Invariant 1, read inside the transaction rather than before it.
     *
     * The unique index `(league_id, player_id)` enforces it anyway, but from
     * inside a transaction it would reach the renderer as `UNKNOWN` — and the
     * name of whoever already has him and the price they paid, which is the
     * information the person running the auction needs, would be lost.
     */
    const owned = tx
      .select({ price: purchase.price, team: fantaTeam.name })
      .from(purchase)
      .innerJoin(fantaTeam, eq(purchase.fantaTeamId, fantaTeam.id))
      .where(and(eq(purchase.leagueId, input.leagueId), eq(purchase.playerId, input.playerId)))
      .get()
    if (owned) raise('PLAYER_ALREADY_OWNED', { team: owned.team, price: owned.price })

    const role = chosen.roleClassic as ClassicRole
    const slots = slotsOf(tx, input.leagueId)
    const state = rosterState(tx, team.id, row.budget, slots)

    const violations = checkPurchase(state, role, input.price, row.minBid, 'blocking')
    const blocking = violations.find((v) => v.blocking)
    if (blocking) refuse(blocking, team.name, role)

    const next =
      (tx
        .select({ n: sql<number | null>`max(${purchase.sequence})` })
        .from(purchase)
        .where(eq(purchase.leagueId, input.leagueId))
        .get()?.n ?? 0) + 1

    const now = Date.now()
    tx.insert(purchase)
      .values({
        uuid: randomUUID(),
        leagueId: input.leagueId,
        fantaTeamId: team.id,
        playerId: input.playerId,
        price: input.price,
        slotRole: role,
        sequence: next,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    log(
      tx,
      input.leagueId,
      'purchase.create',
      { player: chosen.name, team: team.name, price: input.price, sequence: next },
      actorUuid,
    )

    // "Nel draft a turni avanza automaticamente dopo ogni assegnazione",
    // document 2 §9. Not in the call format: there is an arrow, `auction.setTurn`.
    if (row.auctionFormat === 'draft') stepTurn(tx, input.leagueId, row.currentTurnTeamId, 1)

    tx.update(league).set({ updatedAt: now }).where(eq(league.id, input.leagueId)).run()
    return auctionState(tx, input.leagueId) as AuctionState
  })
}

/**
 * The turn, moved one place along the order and wrapping round.
 *
 * `step` is +1 to advance and −1 to put it back, and the two are the same
 * function on purpose: an undo has to be the exact inverse of the assignment
 * that advanced it, and two separate implementations of "the next one" and "the
 * previous one" would disagree at the ends of the list.
 */
function stepTurn(on: Writer, leagueId: number, current: number | null, step: 1 | -1): void {
  const teams = on
    .select({ id: fantaTeam.id })
    .from(fantaTeam)
    .where(eq(fantaTeam.leagueId, leagueId))
    .orderBy(fantaTeam.orderIndex)
    .all()
  if (teams.length === 0) return

  const at = teams.findIndex((t) => t.id === current)
  // Nobody's turn: advancing lands on the first, going back on the last.
  const from = at === -1 ? (step === 1 ? -1 : 0) : at
  const next = teams[(from + step + teams.length) % teams.length]
  on.update(league).set({ currentTurnTeamId: next.id }).where(eq(league.id, leagueId)).run()
}

/**
 * `Ctrl/Cmd+Z`: the last purchase, undone for real.
 *
 * A true delete and not a flag, and document 1 says so in the schema itself: the
 * unique index `(league_id, player_id)` does not tolerate a half-deleted row, so
 * a player cancelled with a marker could never be bought again.
 *
 * In a draft the turn steps back with it. It is the inverse of what `assign`
 * did — one place along the order — and not "give the turn to whoever bought":
 * the two coincide when the buyer was the team on turn, and when they are not
 * (nothing forbids buying out of turn) only the first one puts the board back
 * the way it was.
 */
export function undo(input: Input<'auction.undo'>, db: Db, actorUuid: string): AuctionState {
  return db.transaction((tx) => {
    const row = requireLeague(tx, input.leagueId)
    requireOpenAuction(row)

    const last = tx
      .select({
        id: purchase.id,
        playerId: purchase.playerId,
        fantaTeamId: purchase.fantaTeamId,
        price: purchase.price,
        sequence: purchase.sequence,
      })
      .from(purchase)
      .where(eq(purchase.leagueId, input.leagueId))
      .orderBy(desc(purchase.sequence))
      .get()
    if (!last) raise('NOTHING_TO_UNDO')

    const name =
      tx.select({ name: player.name }).from(player).where(eq(player.id, last.playerId)).get()
        ?.name ?? ''
    const team =
      tx.select({ name: fantaTeam.name }).from(fantaTeam).where(eq(fantaTeam.id, last.fantaTeamId)).get()
        ?.name ?? ''

    tx.delete(purchase).where(eq(purchase.id, last.id)).run()

    if (row.auctionFormat === 'draft') {
      stepTurn(tx, input.leagueId, row.currentTurnTeamId, -1)
    }

    log(
      tx,
      input.leagueId,
      'purchase.undo',
      { player: name, team, price: last.price, sequence: last.sequence },
      actorUuid,
    )

    tx.update(league).set({ updatedAt: Date.now() }).where(eq(league.id, input.leagueId)).run()
    return auctionState(tx, input.leagueId) as AuctionState
  })
}

/**
 * The arrow of document 2 §9: in the call format the turn is shown and does not
 * advance by itself, and this is how it is moved by hand.
 */
export function setTurn(input: Input<'auction.setTurn'>, db: Db, actorUuid: string): AuctionState {
  return db.transaction((tx) => {
    const row = requireLeague(tx, input.leagueId)
    requireOpenAuction(row)

    if (input.fantaTeamId !== null) teamOf(tx, input.leagueId, input.fantaTeamId)

    tx.update(league)
      .set({ currentTurnTeamId: input.fantaTeamId, updatedAt: Date.now() })
      .where(eq(league.id, input.leagueId))
      .run()

    log(tx, input.leagueId, 'turn.set', { fantaTeamId: input.fantaTeamId }, actorUuid)
    return auctionState(tx, input.leagueId) as AuctionState
  })
}

/**
 * Closes the auction and opens the revision.
 *
 * It does not refuse incomplete rosters: document 2 §7 lists them among the
 * things that are "permesso, con avviso", and the warning is a confirmation the
 * interface asks for — with the numbers `auctionState` already gives it. There
 * is nothing to protect here: an incomplete roster corrupts nothing, and by the
 * end of the evening it happens.
 */
export function closeAuction(
  input: Input<'auction.close'>,
  db: Db,
  actorUuid: string,
): AuctionState {
  return db.transaction((tx) => {
    const row = requireLeague(tx, input.leagueId)
    if (frozen(row.status)) raise('LEAGUE_FROZEN')
    if (!canTransition(row.status, 'review')) raise('AUCTION_NOT_OPEN')

    // Counted for the register, not to refuse with.
    const teams = tx
      .select({ id: fantaTeam.id })
      .from(fantaTeam)
      .where(eq(fantaTeam.leagueId, input.leagueId))
      .all()
    const perTeam = totalSlots(slotsOf(tx, input.leagueId))
    const incomplete = teams.filter((t) => rosterFilled(tx, t.id) < perTeam).length

    tx.update(league)
      .set({ status: 'review', updatedAt: Date.now() })
      .where(eq(league.id, input.leagueId))
      .run()

    log(tx, input.leagueId, 'auction.close', { incomplete }, actorUuid)
    return auctionState(tx, input.leagueId) as AuctionState
  })
}

function rosterFilled(on: Reader, teamId: number): number {
  return on.select({ id: purchase.id }).from(purchase).where(eq(purchase.fantaTeamId, teamId)).all()
    .length
}
