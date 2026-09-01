import { randomUUID } from 'node:crypto'
import { count, eq, sql } from 'drizzle-orm'
import type { Input } from '@shared/contracts'
import {
  CLASSIC_ROLES,
  frozen,
  permutationOf,
  rulesEditable,
  teamListEditable,
  totalSlots,
  type ClassicRole,
} from '@shared/domain'
import { raise } from '@shared/errors'
import type { LeagueDetail, LeagueSummary } from '@shared/types'
import type { Db } from '../db/client'
import { fantaTeam, league, leagueSlot, purchase, season } from '../db/schema'

/**
 * Leagues and their teams, T11.
 *
 * Every invariant of document 1 §5 that touches this task lives here and not in
 * the interface — rule 2 of CLAUDE.md. The wizard greys out its button, this
 * refuses: 9 (a team leaves only before the auction), 13 (a crystallised league
 * is read-only) and 16 (the rules freeze when the auction starts).
 *
 * The predicates themselves are in shared/domain.ts as pure functions, because a
 * guard written inside a query is a guard no test on Node can reach — document 6
 * §3. This file decides *when* to ask; it does not decide the answer.
 *
 * Everything runs inside `db.transaction`, and every check is made in there
 * rather than before it. Not defensiveness: `ipcMain.handle` does not serialise
 * invokes, so two windows — or one impatient double click — can interleave, and
 * a status read outside the transaction that protects it describes the past.
 */

/** Anything that can read: the database, or a transaction inside it. */
type Reader = Pick<Db, 'select'>

/** Anything that can read and write, which is what every mutation is handed. */
type Writer = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

const EMPTY_SLOTS: Record<ClassicRole, number> = { P: 0, D: 0, C: 0, A: 0 }

/* -------------------------------------------------------------- reading */

function slotsOf(on: Reader, leagueId: number): Record<ClassicRole, number> {
  const rows = on.select().from(leagueSlot).where(eq(leagueSlot.leagueId, leagueId)).all()
  const slots = { ...EMPTY_SLOTS }
  for (const row of rows) slots[row.roleCode as ClassicRole] = row.slots
  return slots
}

function teamsOf(on: Reader, leagueId: number): LeagueDetail['teams'] {
  return on
    .select()
    .from(fantaTeam)
    .where(eq(fantaTeam.leagueId, leagueId))
    .orderBy(fantaTeam.orderIndex)
    .all()
    .map((t) => ({
      id: t.id,
      uuid: t.uuid,
      name: t.name,
      manager: t.manager,
      color: t.color,
      isMine: t.isMine === 1,
      orderIndex: t.orderIndex,
    }))
}

/**
 * The whole league, which is what every mutation answers with.
 *
 * Reading it back costs four small queries and removes a class of bug: a reorder
 * moves every row, a deletion renumbers the ones after it, and adding a team
 * changes what the coherence check says. A renderer patching its own copy from
 * the shape of the request would drift from the database on the first refusal.
 */
export function readLeague(on: Reader, id: number): LeagueDetail | null {
  const row = on
    .select({ league, seasonLabel: season.label })
    .from(league)
    .innerJoin(season, eq(league.seasonId, season.id))
    .where(eq(league.id, id))
    .get()
  if (!row) return null

  const teams = teamsOf(on, id)
  const slots = slotsOf(on, id)
  const filled =
    on.select({ n: count() }).from(purchase).where(eq(purchase.leagueId, id)).get()?.n ?? 0

  return {
    id: row.league.id,
    uuid: row.league.uuid,
    name: row.league.name,
    seasonId: row.league.seasonId,
    seasonLabel: row.seasonLabel,
    mode: row.league.mode,
    auctionFormat: row.league.auctionFormat,
    status: row.league.status,
    budget: row.league.budget,
    minBid: row.league.minBid,
    defenseModifier: row.league.defenseModifier === 1,
    instanceRole: row.league.instanceRole,
    teamCount: teams.length,
    slotsTotal: teams.length * totalSlots(slots),
    slotsFilled: filled,
    slots,
    teams,
    createdAt: row.league.createdAt,
    updatedAt: row.league.updatedAt,
  }
}

/** The home of document 2 §4.2. Grouped queries, never one per league. */
export function listLeagues(db: Db): LeagueSummary[] {
  const rows = db
    .select({ league, seasonLabel: season.label })
    .from(league)
    .innerJoin(season, eq(league.seasonId, season.id))
    // Newest first: the one being prepared is nearly always the last touched.
    .orderBy(sql`${league.updatedAt} desc`)
    .all()

  const teamCounts = new Map<number, number>()
  for (const row of db
    .select({ leagueId: fantaTeam.leagueId, n: count() })
    .from(fantaTeam)
    .groupBy(fantaTeam.leagueId)
    .all()) {
    teamCounts.set(row.leagueId, row.n)
  }

  const slotTotals = new Map<number, number>()
  for (const row of db
    .select({ leagueId: leagueSlot.leagueId, n: sql<number>`sum(${leagueSlot.slots})` })
    .from(leagueSlot)
    .groupBy(leagueSlot.leagueId)
    .all()) {
    slotTotals.set(row.leagueId, row.n)
  }

  const filled = new Map<number, number>()
  for (const row of db
    .select({ leagueId: purchase.leagueId, n: count() })
    .from(purchase)
    .groupBy(purchase.leagueId)
    .all()) {
    filled.set(row.leagueId, row.n)
  }

  return rows.map(({ league: l, seasonLabel }) => {
    const teamCount = teamCounts.get(l.id) ?? 0
    return {
      id: l.id,
      uuid: l.uuid,
      name: l.name,
      seasonId: l.seasonId,
      seasonLabel,
      mode: l.mode,
      auctionFormat: l.auctionFormat,
      status: l.status,
      budget: l.budget,
      minBid: l.minBid,
      teamCount,
      slotsTotal: teamCount * (slotTotals.get(l.id) ?? 0),
      slotsFilled: filled.get(l.id) ?? 0,
      updatedAt: l.updatedAt,
    }
  })
}

/* -------------------------------------------------------------- guards */

/** The league a mutation names, or a refusal that says so. */
function requireLeague(
  on: Reader,
  id: number,
): { id: number; status: LeagueDetail['status']; name: string } {
  const row = on
    .select({ id: league.id, status: league.status, name: league.name })
    .from(league)
    .where(eq(league.id, id))
    .get()
  if (!row) raise('LEAGUE_MISSING')
  return row
}

/**
 * Invariant 13 first, then whichever of 9 and 16 the caller answers to.
 *
 * Two calls and not one, because a crystallised league and a running auction
 * refuse for different reasons and the way out differs: the first says to reopen
 * the report, the second says the rules are settled. A single message for both
 * would send the reader to the wrong door.
 */
function refuseIfFrozen(status: LeagueDetail['status']): void {
  if (frozen(status)) raise('LEAGUE_FROZEN')
}

/* -------------------------------------------------------------- writing */

/**
 * Rewrites `order_index` over the ids in the order given, through negative
 * temporaries.
 *
 * `UNIQUE (league_id, order_index)` is immediate in SQLite, not deferred to the
 * end of the transaction: assigning 3 to the team that should follow the one
 * still holding 3 fails on that row. So the first pass parks every team on
 * `-(i+1)`, which no real row can hold, and the second brings them back up. The
 * constraint is the reason the reorder looks like this, and CLAUDE.md says the
 * reorder is what gets fixed if it fails — not the constraint.
 */
function renumber(on: Writer, ids: readonly number[]): void {
  ids.forEach((id, i) => {
    on.update(fantaTeam)
      .set({ orderIndex: -(i + 1) })
      .where(eq(fantaTeam.id, id))
      .run()
  })
  ids.forEach((id, i) => {
    on.update(fantaTeam).set({ orderIndex: i }).where(eq(fantaTeam.id, id)).run()
  })
}

/** Team ids of a league, in turn order. */
function teamIdsOf(on: Reader, leagueId: number): number[] {
  return on
    .select({ id: fantaTeam.id })
    .from(fantaTeam)
    .where(eq(fantaTeam.leagueId, leagueId))
    .orderBy(fantaTeam.orderIndex)
    .all()
    .map((r) => r.id)
}

/**
 * Clears whoever is currently marked as yours, so the next write can set it.
 *
 * `idx_one_mine` is a partial unique index over `league_id WHERE is_mine = 1`:
 * raising the flag on a second team fails on that row, exactly like the order
 * index. One statement before, inside the same transaction, and the two never
 * coexist.
 */
function clearMine(on: Writer, leagueId: number): void {
  on.update(fantaTeam)
    .set({ isMine: 0 })
    .where(sql`${fantaTeam.leagueId} = ${leagueId} and ${fantaTeam.isMine} = 1`)
    .run()
}

/** Refuses the name the UNIQUE (league_id, name) constraint would refuse. */
function refuseTakenName(on: Reader, leagueId: number, name: string, exceptId?: number): void {
  const clash = on
    .select({ id: fantaTeam.id })
    .from(fantaTeam)
    .where(sql`${fantaTeam.leagueId} = ${leagueId} and ${fantaTeam.name} = ${name}`)
    .all()
    .find((row) => row.id !== exceptId)
  if (clash) raise('TEAM_NAME_TAKEN', { name })
}

/**
 * The wizard of document 2 §4.3, committed once.
 *
 * The three steps are collected in the renderer and arrive together, because the
 * document ends them with "un riepilogo finale" — a summary you can still walk
 * back from cannot already be in the database. So the league, its slots and its
 * teams are one transaction: either the whole wizard happened or none of it did,
 * and no half-league is ever listed on the home.
 *
 * It is born in `pre_auction`, which is where §4.3 says the wizard leaves it.
 * `setup` stays the column default for a row created any other way, and the
 * transitions out of both are the same.
 */
export function createLeague(input: Input<'league.create'>, db: Db): LeagueDetail {
  const now = Date.now()

  return db.transaction((tx) => {
    // A foreign key would refuse this too, from inside the transaction and
    // without a word the reader could use — which is the failure mode CLAUDE.md
    // describes for constraints the schema cannot phrase.
    const known = tx
      .select({ id: season.id })
      .from(season)
      .where(eq(season.id, input.seasonId))
      .get()
    if (!known) raise('LEAGUE_SEASON_MISSING', { seasonId: input.seasonId })

    // Document 2 §4.3: "Minimo due squadre". Refused here rather than in the
    // contract so the sentence the person reads names the rule.
    if (input.teams.length < 2) raise('TOO_FEW_TEAMS')
    if (input.teams.filter((t) => t.isMine).length > 1) raise('TOO_MANY_MINE')

    const names = input.teams.map((t) => t.name)
    const duplicate = names.find((name, i) => names.indexOf(name) !== i)
    if (duplicate !== undefined) raise('TEAM_NAME_TAKEN', { name: duplicate })

    const created = tx
      .insert(league)
      .values({
        uuid: randomUUID(),
        name: input.name,
        seasonId: input.seasonId,
        mode: input.mode,
        auctionFormat: input.auctionFormat,
        budget: input.budget,
        minBid: input.minBid,
        status: 'pre_auction',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: league.id })
      .get()

    for (const role of CLASSIC_ROLES) {
      tx.insert(leagueSlot)
        .values({ leagueId: created.id, roleCode: role, slots: input.slots[role] })
        .run()
    }

    input.teams.forEach((team, i) => {
      tx.insert(fantaTeam)
        .values({
          uuid: randomUUID(),
          leagueId: created.id,
          name: team.name,
          manager: team.manager,
          color: team.color,
          isMine: team.isMine ? 1 : 0,
          // The drag order of step 2, which document 1 §3 calls the turn.
          orderIndex: i,
        })
        .run()
    })

    return readLeague(tx, created.id)!
  })
}

/**
 * The rules, invariant 16 — and only the six things it names.
 *
 * `budget`, `min_bid`, `auction_format`, `mode`, `defense_modifier` and
 * `league_slot` freeze when the auction starts. The name and the admin/participant
 * role do not appear in that list and are not frozen with them: a league misspelt
 * at nine in the evening should be fixable at ten, and neither field takes part in
 * any arithmetic. So the lock is asked about only when the patch actually carries
 * one of the six, rather than at the door.
 */
export function updateLeague(input: Input<'league.update'>, db: Db): LeagueDetail {
  return db.transaction((tx) => {
    const current = requireLeague(tx, input.id)
    refuseIfFrozen(current.status)

    const touchesRules =
      input.mode !== undefined ||
      input.auctionFormat !== undefined ||
      input.budget !== undefined ||
      input.minBid !== undefined ||
      input.defenseModifier !== undefined ||
      input.slots !== undefined
    if (touchesRules && !rulesEditable(current.status)) raise('RULES_LOCKED')

    const { id, slots, ...fields } = input
    const patch = {
      ...(fields.name !== undefined && { name: fields.name }),
      ...(fields.mode !== undefined && { mode: fields.mode }),
      ...(fields.auctionFormat !== undefined && { auctionFormat: fields.auctionFormat }),
      ...(fields.budget !== undefined && { budget: fields.budget }),
      ...(fields.minBid !== undefined && { minBid: fields.minBid }),
      ...(fields.defenseModifier !== undefined && {
        defenseModifier: fields.defenseModifier ? 1 : 0,
      }),
      ...(fields.instanceRole !== undefined && { instanceRole: fields.instanceRole }),
    }

    // `updated_at` moves even when only the slots changed: it is what orders the
    // home, and a league whose roster was just reshaped is the one being worked on.
    tx.update(league)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(league.id, id))
      .run()

    if (slots) {
      for (const role of CLASSIC_ROLES) {
        tx.insert(leagueSlot)
          .values({ leagueId: id, roleCode: role, slots: slots[role] })
          .onConflictDoUpdate({
            target: [leagueSlot.leagueId, leagueSlot.roleCode],
            set: { slots: slots[role] },
          })
          .run()
      }
    }

    return readLeague(tx, id)!
  })
}

/**
 * Removes a league and, by cascade, everything hanging off it.
 *
 * Two refusals. `closed` is invariant 13: nothing is written to `purchase`,
 * `fanta_team` or `league_slot` in a crystallised league, and a cascade is a
 * write. The other is invariant 9 read one level up — what that invariant
 * protects is not a state but the purchases the cascade would take away, so this
 * asks about the purchases directly rather than about the status.
 *
 * Which means a league started by mistake and never bid on is still removable,
 * and one with an auction in it is not. The first version of this trusted the
 * interface to ask for confirmation instead; driving the app showed what that
 * meant — one IPC call, and an auction in progress was gone.
 */
export function deleteLeague(input: Input<'league.delete'>, db: Db): void {
  db.transaction((tx) => {
    const current = requireLeague(tx, input.id)
    refuseIfFrozen(current.status)

    const purchases =
      tx.select({ n: count() }).from(purchase).where(eq(purchase.leagueId, input.id)).get()?.n ?? 0
    if (purchases > 0) raise('LEAGUE_HAS_PURCHASES', { n: purchases })

    tx.delete(league).where(eq(league.id, input.id)).run()
  })
}

/* ---------------------------------------------------------------- teams */

export function createTeam(input: Input<'team.create'>, db: Db): LeagueDetail {
  return db.transaction((tx) => {
    const current = requireLeague(tx, input.leagueId)
    refuseIfFrozen(current.status)
    if (!teamListEditable(current.status)) raise('TEAMS_LOCKED')
    refuseTakenName(tx, input.leagueId, input.name)

    // `max + 1` rather than the count: a gap left by anything that did not
    // renumber would otherwise hand out an index somebody already holds.
    const last =
      tx
        .select({ n: sql<number>`coalesce(max(${fantaTeam.orderIndex}), -1)` })
        .from(fantaTeam)
        .where(eq(fantaTeam.leagueId, input.leagueId))
        .get()?.n ?? -1

    if (input.isMine) clearMine(tx, input.leagueId)

    tx.insert(fantaTeam)
      .values({
        uuid: randomUUID(),
        leagueId: input.leagueId,
        name: input.name,
        manager: input.manager,
        color: input.color,
        isMine: input.isMine ? 1 : 0,
        orderIndex: last + 1,
      })
      .run()

    tx.update(league).set({ updatedAt: Date.now() }).where(eq(league.id, input.leagueId)).run()
    return readLeague(tx, input.leagueId)!
  })
}

/**
 * Name, manager, colour and "this one is mine".
 *
 * Not guarded by invariant 9: renaming a team carries no arithmetic and breaks
 * nothing mid-auction — somebody who typed "Bomner FC" at nine in the evening
 * should be able to fix it at ten. Invariant 13 still applies, because `closed`
 * means the report is signed.
 */
export function updateTeam(input: Input<'team.update'>, db: Db): LeagueDetail {
  return db.transaction((tx) => {
    const team = tx
      .select({ id: fantaTeam.id, leagueId: fantaTeam.leagueId })
      .from(fantaTeam)
      .where(eq(fantaTeam.id, input.id))
      .get()
    if (!team) raise('TEAM_MISSING')

    const current = requireLeague(tx, team.leagueId)
    refuseIfFrozen(current.status)

    if (input.name !== undefined) refuseTakenName(tx, team.leagueId, input.name, team.id)
    if (input.isMine === true) clearMine(tx, team.leagueId)

    tx.update(fantaTeam)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.manager !== undefined && { manager: input.manager }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.isMine !== undefined && { isMine: input.isMine ? 1 : 0 }),
      })
      .where(eq(fantaTeam.id, input.id))
      .run()

    tx.update(league).set({ updatedAt: Date.now() }).where(eq(league.id, team.leagueId)).run()
    return readLeague(tx, team.leagueId)!
  })
}

/**
 * Invariant 9: only in `setup` and `pre_auction`, because afterwards the cascade
 * would take the team's purchases with it and say nothing.
 *
 * The survivors are renumbered so the turn order stays contiguous. A gap is legal
 * — the constraint only asks for distinct indices — but "la squadra numero 4" of a
 * draft would then be the fifth row on screen.
 */
export function deleteTeam(input: Input<'team.delete'>, db: Db): LeagueDetail {
  return db.transaction((tx) => {
    const team = tx
      .select({ id: fantaTeam.id, leagueId: fantaTeam.leagueId })
      .from(fantaTeam)
      .where(eq(fantaTeam.id, input.id))
      .get()
    if (!team) raise('TEAM_MISSING')

    const current = requireLeague(tx, team.leagueId)
    refuseIfFrozen(current.status)
    if (!teamListEditable(current.status)) raise('TEAMS_LOCKED')

    tx.delete(fantaTeam).where(eq(fantaTeam.id, input.id)).run()
    // Riletti dopo la DELETE, dentro la stessa transazione: la riga tolta non
    // c'è già più, e filtrarla via sarebbe una difesa che non difende da niente.
    renumber(tx, teamIdsOf(tx, team.leagueId))

    tx.update(league).set({ updatedAt: Date.now() }).where(eq(league.id, team.leagueId)).run()
    return readLeague(tx, team.leagueId)!
  })
}

/** The whole order at once, checked against the league's own teams first. */
export function reorderTeams(input: Input<'team.reorder'>, db: Db): LeagueDetail {
  return db.transaction((tx) => {
    const current = requireLeague(tx, input.leagueId)
    refuseIfFrozen(current.status)
    if (!teamListEditable(current.status)) raise('TEAMS_LOCKED')

    // Read inside the transaction: a team deleted in another window between the
    // drag and the drop would otherwise be renumbered back into existence.
    const order = permutationOf(teamIdsOf(tx, input.leagueId), input.teamIds)
    // Not a domain refusal: a list that is not the league's teams is a renderer
    // that lost track, not a rule somebody broke.
    if (!order) raise('BAD_INPUT')

    renumber(tx, order)
    tx.update(league).set({ updatedAt: Date.now() }).where(eq(league.id, input.leagueId)).run()
    return readLeague(tx, input.leagueId)!
  })
}
