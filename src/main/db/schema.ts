import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

/**
 * Transcribed from document 1 §4. The DDL there is the source of truth: when the
 * two disagree, the document wins and this file is wrong.
 *
 * Enum lists and check() are deliberately both present. The enum types the column
 * in TypeScript and emits nothing; check() emits the SQL constraint. Rule 2 of
 * CLAUDE.md wants the database to defend itself, not just the compiler.
 *
 * One exception, and it is the document's: `season.source` states its two values
 * in a comment rather than a CHECK, so there is no check() here either. Nothing
 * at the database level stops a third value — the import service of T7 has to
 * validate it.
 *
 * `player_fts` is not here: drizzle-kit cannot express a virtual table, so the
 * FTS5 index lives as raw SQL in the migration.
 *
 * Every `*_at` column is an INTEGER holding epoch **milliseconds**, i.e. exactly
 * what Date.now() returns. The document says INTEGER without fixing the unit;
 * this is the choice, and it has to stay the same everywhere.
 */

const ROLES = ['P', 'D', 'C', 'A'] as const

/* ---------------------------------------------------------------- reference */

export const season = sqliteTable('season', {
  id: text('id').primaryKey(), // '2026-27'
  label: text('label').notNull(),
  datasetVersion: text('dataset_version').notNull(), // aligned with the manifest
  source: text('source', { enum: ['github', 'xlsx'] }).notNull(), // origin of the LAST import
  hasFbref: integer('has_fbref').notNull().default(0),
  importedAt: integer('imported_at').notNull(),
})

export const serieATeam = sqliteTable(
  'serie_a_team',
  {
    id: integer('id').primaryKey(),
    seasonId: text('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
  },
  (t) => [unique().on(t.seasonId, t.name)],
)

export const player = sqliteTable(
  'player',
  {
    id: integer('id').primaryKey(),
    seasonId: text('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id').notNull(), // the listone's own 'Id' column
    identityKey: text('identity_key').notNull(), // 'fc-<source_id>'
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(), // lowercase, no diacritics
    serieATeamId: integer('serie_a_team_id')
      .notNull()
      .references(() => serieATeam.id),
    roleClassic: text('role_classic', { enum: ROLES }).notNull(),
    qtClassicInitial: real('qt_classic_initial'),
    qtClassicCurrent: real('qt_classic_current'),
    qtMantraInitial: real('qt_mantra_initial'),
    qtMantraCurrent: real('qt_mantra_current'),
    fvmClassic: real('fvm_classic'),
    fvmMantra: real('fvm_mantra'),
    birthDate: text('birth_date'), // from FBref, absent without the optional stage
    penaltyTaker: integer('penalty_taker').notNull().default(0),
    penaltyTakerSource: text('penalty_taker_source', { enum: ['derived', 'manual'] }),
    delistedAt: integer('delisted_at'), // gone from a later listone
  },
  (t) => [
    unique().on(t.seasonId, t.sourceId),
    check('player_role_classic', sql`${t.roleClassic} in ('P','D','C','A')`),
    check(
      'player_penalty_taker_source',
      sql`${t.penaltyTakerSource} is null or ${t.penaltyTakerSource} in ('derived','manual')`,
    ),
    index('idx_player_season_role').on(t.seasonId, t.roleClassic),
    index('idx_player_team').on(t.serieATeamId),
    index('idx_player_identity').on(t.identityKey),
    index('idx_player_name_norm').on(t.nameNormalized),
  ],
)

export const playerMantraRole = sqliteTable(
  'player_mantra_role',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    roleCode: text('role_code').notNull(), // Por Dc Dd Ds E M C W T A Pc
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.roleCode] }),
    index('idx_mantra_role').on(t.roleCode),
  ],
)

export const playerExternalId = sqliteTable(
  'player_external_id',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['fbref', 'apiFootball'] }).notNull(),
    externalId: text('external_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.source] }),
    check('player_external_id_source', sql`${t.source} in ('fbref','apiFootball')`),
    // makes the lookup from an API response deterministic
    index('idx_ext_lookup').on(t.source, t.externalId),
  ],
)

export const playerSeasonStat = sqliteTable(
  'player_season_stat',
  {
    id: integer('id').primaryKey(),
    identityKey: text('identity_key').notNull(),
    // NO foreign key here, and none is to be added: the statistics cover seasons
    // that have no row in `season`, which only holds those with a listone.
    seasonId: text('season_id').notNull(),
    teamName: text('team_name'),
    roleClassic: text('role_classic'),

    // from Fantacalcio.it, always present
    matchesRated: integer('matches_rated'), // 'Pv' — matches WITH A VOTE, not appearances
    avgVote: real('avg_vote'), // 'Mv'
    fantaAvg: real('fanta_avg'), // 'Fm'
    goals: integer('goals'), // 'Gf'
    goalsConceded: integer('goals_conceded'), // 'Gs', goalkeepers
    assists: integer('assists'), // 'Ass'
    penaltiesTaken: integer('penalties_taken'), // 'Rc'
    penaltiesScored: integer('penalties_scored'), // 'R+'
    penaltiesMissed: integer('penalties_missed'), // 'R-'
    penaltiesSaved: integer('penalties_saved'), // 'Rp'
    yellowCards: integer('yellow_cards'), // 'Amm'
    redCards: integer('red_cards'), // 'Esp'
    ownGoals: integer('own_goals'), // 'Au'

    // from FBref, null when the optional stage did not run
    matchesPlayed: integer('matches_played'), // 'MP', total appearances
    starts: integer('starts'),
    minutes: integer('minutes'),
    cleanSheets: integer('clean_sheets'), // 'CS', goalkeepers
  },
  (t) => [
    unique().on(t.identityKey, t.seasonId),
    index('idx_stat_identity').on(t.identityKey),
  ],
)

/* --------------------------------------------------------------- live data */

/** A cache, not a source of truth: the interface always reads here, never the
 *  network, and always shows how old the value is. */
export const playerAvailability = sqliteTable(
  'player_availability',
  {
    playerId: integer('player_id')
      .primaryKey()
      .references(() => player.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['available', 'injured', 'suspended', 'doubtful'],
    }).notNull(),
    reason: text('reason'),
    expectedReturn: text('expected_return'), // a date or free text
    source: text('source').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    check(
      'player_availability_status',
      sql`${t.status} in ('available','injured','suspended','doubtful')`,
    ),
  ],
)

/* --------------------------------------------------------------- user data */

export const appInstance = sqliteTable(
  'app_instance',
  {
    id: integer('id').primaryKey(),
    uuid: text('uuid').notNull(),
    label: text('label'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [check('app_instance_single_row', sql`${t.id} = 1`)],
)

export const league = sqliteTable(
  'league',
  {
    id: integer('id').primaryKey(),
    uuid: text('uuid').notNull().unique(),
    name: text('name').notNull(),
    seasonId: text('season_id')
      .notNull()
      .references(() => season.id),
    mode: text('mode', { enum: ['classic', 'mantra'] }).notNull(),
    auctionFormat: text('auction_format', { enum: ['call', 'draft'] }).notNull(),
    budget: integer('budget').notNull().default(500),
    minBid: integer('min_bid').notNull().default(1),
    defenseModifier: integer('defense_modifier').notNull().default(0),
    scoringWeights: text('scoring_weights'), // JSON, weights of the synthetic score
    instanceRole: text('instance_role', { enum: ['admin', 'participant'] })
      .notNull()
      .default('admin'),
    status: text('status', {
      enum: ['setup', 'pre_auction', 'auction', 'review', 'closed'],
    })
      .notNull()
      .default('setup'),
    // Circular by design: fanta_team points back at league. SQLite resolves
    // foreign keys on write, not on create, so the cycle is only a TypeScript
    // problem — hence the explicit return type.
    currentTurnTeamId: integer('current_turn_team_id').references(
      (): AnySQLiteColumn => fantaTeam.id,
      { onDelete: 'set null' },
    ),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('league_mode', sql`${t.mode} in ('classic','mantra')`),
    check('league_auction_format', sql`${t.auctionFormat} in ('call','draft')`),
    check('league_instance_role', sql`${t.instanceRole} in ('admin','participant')`),
    check(
      'league_status',
      sql`${t.status} in ('setup','pre_auction','auction','review','closed')`,
    ),
  ],
)

export const leagueSlot = sqliteTable(
  'league_slot',
  {
    leagueId: integer('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    roleCode: text('role_code', { enum: ROLES }).notNull(),
    slots: integer('slots').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.roleCode] }),
    check('league_slot_role_code', sql`${t.roleCode} in ('P','D','C','A')`),
    check('league_slot_slots', sql`${t.slots} >= 0`),
  ],
)

export const fantaTeam = sqliteTable(
  'fanta_team',
  {
    id: integer('id').primaryKey(),
    uuid: text('uuid').notNull().unique(),
    leagueId: integer('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    manager: text('manager'),
    isMine: integer('is_mine').notNull().default(0),
    orderIndex: integer('order_index').notNull(),
    color: text('color'),
  },
  (t) => [
    unique().on(t.leagueId, t.name),
    // Immediate, not deferrable. Reordering must rewrite every index inside one
    // transaction, passing through negative temporaries. Do not remove it.
    unique().on(t.leagueId, t.orderIndex),
    // only one team per league can be yours
    uniqueIndex('idx_one_mine').on(t.leagueId).where(sql`${t.isMine} = 1`),
  ],
)

export const purchase = sqliteTable(
  'purchase',
  {
    id: integer('id').primaryKey(),
    uuid: text('uuid').notNull().unique(),
    leagueId: integer('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    fantaTeamId: integer('fanta_team_id')
      .notNull()
      .references(() => fantaTeam.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    price: integer('price').notNull(),
    slotRole: text('slot_role', { enum: ROLES }).notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('purchase_price', sql`${t.price} >= 0`),
    check('purchase_slot_role', sql`${t.slotRole} in ('P','D','C','A')`),
    // Undo deletes the row for real. A soft delete would break this index and
    // the cancelled player could never be bought again.
    uniqueIndex('idx_purchase_player').on(t.leagueId, t.playerId),
    index('idx_purchase_team').on(t.fantaTeamId),
    index('idx_purchase_sequence').on(t.leagueId, t.sequence),
  ],
)

export const auctionLog = sqliteTable(
  'auction_log',
  {
    id: integer('id').primaryKey(),
    leagueId: integer('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    phase: text('phase', { enum: ['auction', 'review'] }).notNull(),
    action: text('action').notNull(),
    payload: text('payload').notNull(), // JSON
    actorUuid: text('actor_uuid').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('auction_log_phase', sql`${t.phase} in ('auction','review')`),
    index('idx_log_league').on(t.leagueId, t.createdAt),
  ],
)

export const leagueSnapshot = sqliteTable(
  'league_snapshot',
  {
    id: integer('id').primaryKey(),
    uuid: text('uuid').notNull().unique(),
    leagueId: integer('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    producedBy: text('produced_by').notNull(),
    producedRole: text('produced_role', { enum: ['admin', 'participant'] }).notNull(),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    unique().on(t.leagueId, t.version),
    check('league_snapshot_produced_role', sql`${t.producedRole} in ('admin','participant')`),
  ],
)

export const target = sqliteTable(
  'target',
  {
    id: integer('id').primaryKey(),
    leagueId: integer('league_id')
      .notNull()
      .references(() => league.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    tier: integer('tier'),
    maxPrice: integer('max_price'),
    rating: integer('rating'),
    note: text('note'),
    priority: integer('priority').notNull().default(0),
  },
  (t) => [
    unique().on(t.leagueId, t.playerId),
    check('target_tier', sql`${t.tier} is null or ${t.tier} between 1 and 5`),
    check('target_max_price', sql`${t.maxPrice} is null or ${t.maxPrice} >= 0`),
    check('target_rating', sql`${t.rating} is null or ${t.rating} between 1 and 5`),
  ],
)

export const plan = sqliteTable('plan', {
  id: integer('id').primaryKey(),
  leagueId: integer('league_id')
    .notNull()
    .references(() => league.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const planItem = sqliteTable(
  'plan_item',
  {
    planId: integer('plan_id')
      .notNull()
      .references(() => plan.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    estPrice: integer('est_price').notNull(),
    slotRole: text('slot_role', { enum: ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.playerId] }),
    check('plan_item_est_price', sql`${t.estPrice} >= 0`),
    check('plan_item_slot_role', sql`${t.slotRole} in ('P','D','C','A')`),
  ],
)
