import { z } from 'zod'
import { CLASSIC_ROLES, LEAGUE_STATUSES } from './domain'

/**
 * The single map of channel → input/output schema, per document 3 §3.
 *
 * Not tRPC: forty request/response channels and no complex subscriptions do not
 * justify two layers of abstraction. What matters — shared types, runtime
 * validation, uniform errors — a typed map gives in fifty lines.
 *
 * Types are derived from the schemas, never rewritten alongside them.
 */

type Contract = { input: z.ZodType; output: z.ZodType }
export type ContractMap = Record<string, Contract>

const ROLE = z.enum(CLASSIC_ROLES)

/** Identity of this installation plus where it keeps its data. */
const appInstance = z.object({
  uuid: z.string(),
  label: z.string().nullable(),
  version: z.string(),
  databasePath: z.string(),
  foreignKeys: z.boolean(),
})

/** How many slots a role has. Zero is legal: a league can decide to skip a role. */
const SLOT_COUNT = z.number().int().min(0)

/**
 * Slots per role, and the shape `league_slot` is read and written as.
 *
 * The four keys are spelled out rather than built from `CLASSIC_ROLES`, so the
 * inferred type is `{ P: number; D: number; ... }` and a caller that forgets one
 * fails to compile — a `z.record` would infer a partial map and hand back
 * `undefined` at runtime for the role nobody set.
 */
const slots = z.object({ P: SLOT_COUNT, D: SLOT_COUNT, C: SLOT_COUNT, A: SLOT_COUNT })

/** One imported season. `dataset.list` answers with these. */
const seasonSummary = z.object({
  id: z.string(),
  label: z.string(),
  datasetVersion: z.string(),
  source: z.string(),
  hasFbref: z.boolean(),
  importedAt: z.number().int(),
  /**
   * Players per role still in the listone, which is the right-hand side of the
   * first coherence check of document 2 §4.3 — "squadre × slot totali contro i
   * giocatori disponibili per ruolo".
   *
   * Here rather than on `player.list`, which the wizard would otherwise have to
   * call to count four numbers: this channel is already loaded by the home and
   * by the onboarding, and four integers cost nothing beside the season's own
   * row. Delisted players are excluded — invariant 10 keeps them in the table
   * with a `delisted_at`, and nobody can buy one.
   */
  playersByRole: slots,
})

/**
 * One row of the players view of document 2 §4.4.
 *
 * The whole season arrives in one call and the renderer does the rest: document
 * 2 §4.4 asks for fuzzy search "mentre digiti, senza pulsante e senza attesa"
 * over a virtualised table, and a round trip per keystroke cannot answer that.
 * Six hundred rows of this are a few hundred kilobytes.
 *
 * The derived metrics of document 1 §6 are **not** here. They are pure functions
 * of these numbers, they live in shared/domain.ts, and sending them too would
 * mean two places that could disagree about what `FM − MV` is.
 */
const seasonStats = z.object({
  matchesRated: z.number().int().nullable(),
  avgVote: z.number().nullable(),
  fantaAvg: z.number().nullable(),
  goalsConceded: z.number().int().nullable(),
  yellowCards: z.number().int().nullable(),
  redCards: z.number().int().nullable(),
  ownGoals: z.number().int().nullable(),
  // The four FBref columns, null unless the optional stage ran.
  matchesPlayed: z.number().int().nullable(),
  starts: z.number().int().nullable(),
  minutes: z.number().int().nullable(),
  cleanSheets: z.number().int().nullable(),
})

const playerRow = z.object({
  id: z.number().int(),
  name: z.string(),
  roleClassic: ROLE,
  /** Badges under the name, per document 2 §4.4: never a column of their own. */
  rolesMantra: z.array(z.string()),
  teamName: z.string(),
  teamCode: z.string().nullable(),
  qtClassicCurrent: z.number().nullable(),
  qtClassicInitial: z.number().nullable(),
  fvmClassic: z.number().nullable(),
  penaltyTaker: z.boolean(),
  /** Gone from the listone but still in the database — invariant 10. */
  delisted: z.boolean(),
  /**
   * His whole history, keyed by season. Empty for a débutant, or for a player
   * the reconciliation could not hang a past on.
   *
   * All of it travels, rather than the one season the table happens to show,
   * so the season selector switches columns without a round trip — the same
   * reason the whole listone arrives at once. It is 1400 rows for a full
   * dataset, a few hundred kilobytes.
   */
  stats: z.record(z.string(), seasonStats),
})

/**
 * What an import did, per document 4 §6. `upToDate` is the answer to step 2 —
 * `latest` already installed — and when it is true every count below is zero and
 * no backup was taken.
 */
const importReport = z.object({
  seasonId: z.string(),
  version: z.string(),
  upToDate: z.boolean(),
  added: z.number().int(),
  updated: z.number().int(),
  /** Marked with `delisted_at`, never removed: invariant 10. */
  delisted: z.number().int(),
  restored: z.number().int(),
  teams: z.number().int(),
  stats: z.number().int(),
  backup: z.string().nullable(),
  hasFbref: z.boolean(),
  hasExternalIds: z.boolean(),
})

/**
 * An AppError travelling as *data* rather than as a refusal.
 *
 * Only the XLSX preview needs this: it succeeds while reporting that the file it
 * read cannot be imported. `code` is typed as a plain string here because the
 * authoritative list is `ErrorCode` in shared/errors.ts and this end only ever
 * echoes what the main process built there — validating the spelling of a string
 * the main process just produced would be theatre.
 */
const appErrorShape = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

/** What an .xlsx would do if imported, per document 2 §4.1 and document 4 §6. */
const listonePreview = z.object({
  file: z.string(),
  /** Only ever a proposal: the file does not say its season reliably. */
  seasonGuess: z.string().nullable(),
  seasons: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      /** History rows this season already has. An XLSX import leaves them alone. */
      stats: z.number().int(),
    }),
  ),
  headerRow: z.number().int().nullable(),
  recognised: z.array(z.string()),
  /** Columns the file has and the app ignores: how a changed file announces itself. */
  unrecognised: z.array(z.string()),
  missing: z.array(z.string()),
  validRows: z.number().int(),
  rejected: z.array(z.string()),
  rejectedTotal: z.number().int(),
  duplicates: z.array(z.number().int()),
  /** Null when the file can be imported as it stands. */
  refusal: appErrorShape.nullable(),
})

/* ------------------------------------------------------------------ league */

const LEAGUE_STATUS = z.enum(LEAGUE_STATUSES)
const MODE = z.enum(['classic', 'mantra'])
const AUCTION_FORMAT = z.enum(['call', 'draft'])
const INSTANCE_ROLE = z.enum(['admin', 'participant'])

/** A hex colour from the palette of document 2 §4.3, or none chosen yet. */
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'non è un colore')
const TEAM_NAME = z.string().trim().min(1).max(60)
const MANAGER = z.string().trim().max(60).nullable()

const teamRow = z.object({
  id: z.number().int(),
  /** The identity that travels in an export, per document 1 §3. */
  uuid: z.string(),
  name: z.string(),
  manager: z.string().nullable(),
  color: z.string().nullable(),
  isMine: z.boolean(),
  /** The turn, per document 1 §3. Contiguous from 0, and unique in the league. */
  orderIndex: z.number().int(),
})

/**
 * One row of the home, document 2 §4.2: "nome, stagione, modalità, numero di
 * squadre, stato, e una barra di avanzamento degli slot assegnati se l'asta è in
 * corso".
 *
 * The progress bar is two numbers rather than a percentage, because a bar is not
 * the only reader: "18 slot su 250" is what the row says when the auction has
 * barely started, and a percentage rounded to zero would say nothing.
 */
const leagueSummary = z.object({
  id: z.number().int(),
  uuid: z.string(),
  name: z.string(),
  seasonId: z.string(),
  seasonLabel: z.string(),
  mode: MODE,
  auctionFormat: AUCTION_FORMAT,
  status: LEAGUE_STATUS,
  budget: z.number().int(),
  minBid: z.number().int(),
  teamCount: z.number().int(),
  /** `teamCount × slot totali`: what the auction has to fill. */
  slotsTotal: z.number().int(),
  /** Purchases registered so far. Zero until T13 writes the first one. */
  slotsFilled: z.number().int(),
  updatedAt: z.number().int(),
})

/**
 * A league with everything the league views need, teams included.
 *
 * Every mutation of this task answers with one of these rather than with what it
 * changed. A reorder moves nine rows, adding a team renumbers nothing but
 * changes what the coherence check says, and a renderer stitching partial
 * answers together would hold an order the database does not have. One shape,
 * one query key, no reconciliation.
 */
const leagueDetail = leagueSummary.extend({
  /** Stored as 0/1 — document 1 §4 — and a flag on both sides of the boundary. */
  defenseModifier: z.boolean(),
  instanceRole: INSTANCE_ROLE,
  slots,
  teams: z.array(teamRow),
  createdAt: z.number().int(),
})

/**
 * A team as the wizard has it before there is a league to hang it on.
 *
 * No id and no uuid: both are the database's to give. The wizard collects rows
 * and `league.create` writes them in the one transaction that creates the league
 * — document 2 §4.3 ends with "un riepilogo finale", and a summary you can still
 * back out of cannot have been written already.
 */
const teamDraft = z.object({
  name: TEAM_NAME,
  manager: MANAGER,
  color: COLOR.nullable(),
  isMine: z.boolean(),
})

/* ------------------------------------------------- objectives and plans */

const TIER = z.number().int().min(1).max(5)
const RATING = z.number().int().min(1).max(5)
const PRICE = z.number().int().min(0)

/**
 * One tile of the board of document 2 §4.6: "nome, squadra, prezzo massimo e
 * rating".
 *
 * The player's own columns travel with the target rather than being looked up in
 * the cached listone. The board belongs to a league and the listone to a season,
 * and a screen that joined the two in the renderer would draw an empty tile for
 * every target whose player has not been fetched yet — including the whole board
 * on a cold start, where nobody has opened Giocatori at all.
 */
const targetRow = z.object({
  playerId: z.number().int(),
  name: z.string(),
  teamName: z.string(),
  teamCode: z.string().nullable(),
  roleClassic: ROLE,
  qtClassicCurrent: z.number().nullable(),
  /** Null is the row of document 2 §4.6 that the star fills: marked, not placed. */
  tier: TIER.nullable(),
  maxPrice: PRICE.nullable(),
  rating: RATING.nullable(),
  note: z.string().nullable(),
  /** Order inside a cell, in the order they were added. */
  priority: z.number().int(),
})

/**
 * One cell of the grid of document 2 §4.7.
 *
 * `slotRole` and nothing else: `plan_item` carries the role the slot belongs to,
 * and the service sets it from the player's own `role_classic` rather than from
 * the request — document 1 §3, "la composizione della rosa resta governata dai
 * ruoli Classic". Sending the player's role alongside it would be two fields
 * that must agree, which is one more than can be kept true.
 */
const planItemRow = z.object({
  playerId: z.number().int(),
  name: z.string(),
  teamName: z.string(),
  teamCode: z.string().nullable(),
  slotRole: ROLE,
  estPrice: PRICE,
  qtClassicCurrent: z.number().nullable(),
})

const planDetail = z.object({
  id: z.number().int(),
  leagueId: z.number().int(),
  name: z.string(),
  createdAt: z.number().int(),
  items: z.array(planItemRow),
})

/* --------------------------------------------------------- the auction */

/**
 * One team as the rose grid of document 2 §4.8 draws it: "crediti residui e
 * puntata massima in ambra, pallini pieni per slot occupati, vuoti per liberi".
 *
 * `maxBid` and `complete` are computed in the main process and travel, rather
 * than being recomputed here from credits and slots. They are invariant 5, and
 * two implementations of an invariant is exactly what document 6 warns about —
 * the screen and the service would agree until the evening they did not.
 */
const auctionTeam = z.object({
  id: z.number().int(),
  uuid: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  isMine: z.boolean(),
  orderIndex: z.number().int(),
  spent: z.number().int(),
  credits: z.number().int(),
  maxBid: z.number().int(),
  filled: slots,
  /** No free slots left: document 2 §7, "la squadra sparisce dal selettore". */
  complete: z.boolean(),
  /** Expanded under the row on click, per §4.8. */
  roster: z.array(
    z.object({
      purchaseId: z.number().int(),
      playerId: z.number().int(),
      name: z.string(),
      teamCode: z.string(),
      slotRole: ROLE,
      price: z.number().int(),
      sequence: z.number().int(),
    }),
  ),
})

const auctionState = z.object({
  league: z.object({
    id: z.number().int(),
    name: z.string(),
    seasonId: z.string(),
    mode: MODE,
    auctionFormat: AUCTION_FORMAT,
    budget: z.number().int(),
    minBid: z.number().int(),
    status: LEAGUE_STATUS,
  }),
  slots,
  /** Shown and, in the call format, moved by hand — document 2 §9. */
  currentTurnTeamId: z.number().int().nullable(),
  slotsTotal: z.number().int(),
  assigned: z.number().int(),
  teams: z.array(auctionTeam),
  /**
   * "I tuoi target ancora non assegnati", §4.8. Whoever has been bought is gone
   * from the list — by anyone, not only by you: that is the point of the panel.
   */
  targetsFree: z.array(
    z.object({
      playerId: z.number().int(),
      name: z.string(),
      roleClassic: ROLE,
      teamCode: z.string(),
      tier: TIER.nullable(),
      rating: RATING.nullable(),
      maxPrice: PRICE.nullable(),
    }),
  ),
  /** What the toast of document 2 §5 names, and what Ctrl+Z would undo. */
  lastPurchase: z
    .object({
      purchaseId: z.number().int(),
      playerId: z.number().int(),
      name: z.string(),
      fantaTeamId: z.number().int(),
      teamName: z.string(),
      price: z.number().int(),
    })
    .nullable(),
})

/** One line of the append-only register of document 1 §3. */
const logEntry = z.object({
  id: z.number().int(),
  phase: z.enum(['auction', 'review']),
  action: z.string(),
  /** JSON as written: the renderer shows it, nothing reads it back as truth. */
  payload: z.string(),
  createdAt: z.number().int(),
})

const listoneReport = z.object({
  seasonId: z.string(),
  label: z.string(),
  seasonCreated: z.boolean(),
  added: z.number().int(),
  updated: z.number().int(),
  delisted: z.number().int(),
  restored: z.number().int(),
  teams: z.number().int(),
  backup: z.string(),
  /** Left untouched: the quotazioni file has no statistics in it. */
  statsUntouched: z.number().int(),
})

export const contracts = {
  'app.instance': {
    input: z.void(),
    output: appInstance,
  },

  'dataset.list': {
    input: z.void(),
    output: z.array(seasonSummary),
  },

  /**
   * `dir` is the folder holding `manifest.json`, which the download of T7b will
   * replace with the fixed URL of document 4 §9. Until then it is the only way to
   * point the app at a dataset, and it is why this channel takes a path at all.
   */
  'dataset.import': {
    input: z.object({ dir: z.string(), seasonId: z.string().optional() }),
    output: importReport,
  },

  /** Opens the native file dialog in the main process. Null if it was cancelled. */
  'listone.pick': {
    input: z.void(),
    output: z.object({ filePath: z.string() }).nullable(),
  },

  'listone.preview': {
    input: z.object({ filePath: z.string() }),
    output: listonePreview,
  },

  'listone.import': {
    input: z.object({
      filePath: z.string(),
      // Refused here, before the service is ever called: `season.id` is a primary
      // key that `league` and `player` reference and that nothing in the app
      // deletes, so a typo confirmed once stays for good. The service checks
      // again — this is the outer of the two, not the only one.
      seasonId: z.string().regex(/^\d{4}-\d{2}$/, "non è una stagione nella forma '2026-27'"),
    }),
    output: listoneReport,
  },

  /**
   * The whole season, once. Filtering, sorting and the fuzzy search happen in the
   * renderer — see `playerRow`.
   *
   * The T4 version took `role`, `search` and friends and filtered with SQL
   * `LIKE`. Two reasons it could not stay. A round trip per keystroke cannot
   * answer "senza attesa percepibile", and `LIKE` does not tolerate a typo:
   * `%dimarko%` matches nothing, while the fuzzy search finds Dimarco. Keeping
   * both would have meant two searches that disagree about the same listone.
   */
  /**
   * The leagues, newest first: document 2 §4.2 lists them as rows and says
   * nothing about their order, and "the one I was working on" is nearly always
   * the last one touched.
   */
  'league.list': {
    input: z.void(),
    output: z.array(leagueSummary),
  },

  /** Null when the id names nothing: a route left open on a deleted league. */
  'league.get': {
    input: z.object({ id: z.number().int() }),
    output: leagueDetail.nullable(),
  },

  /**
   * The whole wizard in one transaction: rules, teams and slots.
   *
   * Nothing here is a domain rule. "Almeno due squadre", the names that must
   * differ, the season that has to exist and the single team that may be yours
   * are all checked by the service, which has a message for each — refusing them
   * here would answer the person who typed a duplicate name with "Richiesta non
   * valida". What the schema does check is shape: a colour that is a colour, a
   * season written the way seasons are written, integers that are integers.
   *
   * `minBid` is at least 1 and `budget` may be anything from 0 up. That is not
   * an oversight: a puntata minima of zero would make invariant 5's maximum bid
   * meaningless, while a budget too small for the roster is a coherence *warning*
   * of document 2 §4.3 — "lo dice subito, senza bloccare" — and a schema that
   * refused it would be blocking what the document asks to be told.
   */
  'league.create': {
    input: z.object({
      name: z.string().trim().min(1).max(60),
      seasonId: z.string().regex(/^\d{4}-\d{2}$/, "non è una stagione nella forma '2026-27'"),
      mode: MODE,
      auctionFormat: AUCTION_FORMAT,
      budget: z.number().int().min(0),
      minBid: z.number().int().min(1),
      slots,
      teams: z.array(teamDraft),
    }),
    output: leagueDetail,
  },

  /**
   * The rules, and only in `setup` and `pre_auction` — invariant 16. Every field
   * is optional and only what arrives is written, so the defence modifier and the
   * admin/participant role can be flipped without resending a budget.
   */
  'league.update': {
    input: z.object({
      id: z.number().int(),
      name: z.string().trim().min(1).max(60).optional(),
      mode: MODE.optional(),
      auctionFormat: AUCTION_FORMAT.optional(),
      budget: z.number().int().min(0).optional(),
      minBid: z.number().int().min(1).optional(),
      defenseModifier: z.boolean().optional(),
      instanceRole: INSTANCE_ROLE.optional(),
      slots: slots.optional(),
    }),
    output: leagueDetail,
  },

  /**
   * Removing a league removes its teams, purchases, targets, plans and snapshots
   * with it, by cascade.
   *
   * Refused on a crystallised league — invariant 13 — and on one that has
   * purchases in it, which is invariant 9 read one level up: what that invariant
   * protects is not a state but the purchases the cascade would take away. So the
   * question is about the purchases and not about the status, and a league started
   * by mistake and never bid on stays removable whatever state it is in.
   */
  'league.delete': {
    input: z.object({ id: z.number().int() }),
    output: z.void(),
  },

  'team.create': {
    input: z.object({
      leagueId: z.number().int(),
      name: TEAM_NAME,
      manager: MANAGER,
      color: COLOR.nullable(),
      isMine: z.boolean(),
    }),
    output: leagueDetail,
  },

  /** Only what arrives is written. `isMine: true` moves it off whoever had it. */
  'team.update': {
    input: z.object({
      id: z.number().int(),
      name: TEAM_NAME.optional(),
      manager: MANAGER.optional(),
      color: COLOR.nullable().optional(),
      isMine: z.boolean().optional(),
    }),
    output: leagueDetail,
  },

  'team.delete': {
    input: z.object({ id: z.number().int() }),
    output: leagueDetail,
  },

  /**
   * The whole order, not a pair of indices.
   *
   * A move sends where every team ended up, so the service can check the list is
   * exactly the league's teams before touching a row — and so two windows cannot
   * apply "move 3 up" to different starting orders. The rewrite itself passes
   * through negative indices inside the transaction: `UNIQUE (league_id,
   * order_index)` is immediate, and CLAUDE.md says not to touch it.
   */
  'team.reorder': {
    input: z.object({ leagueId: z.number().int(), teamIds: z.array(z.number().int()) }),
    output: leagueDetail,
  },

  'target.list': {
    input: z.object({ leagueId: z.number().int() }),
    output: z.array(targetRow),
  },

  /**
   * Creates or edits, which is what makes the star of document 2 §4.4 a single
   * gesture: it does not have to know whether the player is already marked.
   *
   * Every editable field is `.nullable().optional()`, and the two are not the
   * same answer. Absent means "leave it as it is" — the star sends nothing but
   * the player and must not wipe the maximum price typed in the detail panel.
   * Null means "clear it", which is the only way back from a tier once given.
   */
  'target.upsert': {
    input: z.object({
      leagueId: z.number().int(),
      playerId: z.number().int(),
      tier: TIER.nullable().optional(),
      maxPrice: PRICE.nullable().optional(),
      rating: RATING.nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    }),
    output: z.array(targetRow),
  },

  'target.delete': {
    input: z.object({ leagueId: z.number().int(), playerId: z.number().int() }),
    output: z.array(targetRow),
  },

  /**
   * Every plan of the league, items included.
   *
   * Whole rather than by id because document 2 §4.7 ends with "due piani si
   * possono affiancare per confronto": a comparison needs both at once, and a
   * plan is at most one roster — twenty-five rows of five fields.
   */
  'plan.list': {
    input: z.object({ leagueId: z.number().int() }),
    output: z.array(planDetail),
  },

  'plan.create': {
    input: z.object({ leagueId: z.number().int(), name: z.string().trim().min(1).max(60) }),
    output: z.array(planDetail),
  },

  'plan.delete': {
    input: z.object({ id: z.number().int() }),
    output: z.array(planDetail),
  },

  /**
   * `slotRole` is not an input: the service reads it from the player. A renderer
   * that could choose which role a player occupies would be able to park a
   * goalkeeper in a defender's cell, and no constraint in the schema says
   * otherwise — `plan_item.slot_role` is a free column with a CHECK on its four
   * letters and nothing tying it to the player it names.
   */
  'plan.addItem': {
    input: z.object({
      planId: z.number().int(),
      playerId: z.number().int(),
      estPrice: PRICE,
    }),
    output: z.array(planDetail),
  },

  /**
   * The estimated price of a cell already filled.
   *
   * Not in the sketch of channels in document 3 §3, which lists `plan.addItem`
   * and `plan.removeItem` and stops. It is added because without it the only way
   * to answer "and if he goes for sixty?" — which is the entire point of a plan —
   * is to empty the cell and fill it again, and a plan is re-priced far more
   * often than it is re-populated.
   */
  'plan.updateItem': {
    input: z.object({
      planId: z.number().int(),
      playerId: z.number().int(),
      estPrice: PRICE,
    }),
    output: z.array(planDetail),
  },

  'plan.removeItem': {
    input: z.object({ planId: z.number().int(), playerId: z.number().int() }),
    output: z.array(planDetail),
  },

  /**
   * The state of the auction, and the answer of every mutation that touches it.
   *
   * Null when the league is gone, like `league.get`. All of it at once because
   * one purchase changes the rose grid for the buying team, the count in the
   * header, the turn if the format is a draft, and the list of free objectives:
   * four pieces of the same photograph, and stitching them together in the
   * renderer would mean holding one of them stale.
   */
  'auction.state': {
    input: z.object({ leagueId: z.number().int() }),
    output: auctionState.nullable(),
  },

  /** Invariant 8. From here on the rules and the listone import are locked. */
  'auction.start': {
    input: z.object({ leagueId: z.number().int() }),
    output: auctionState,
  },

  /**
   * `slotRole` is not an input: the player's role decides it.
   *
   * That is invariant 6 made impossible rather than checked. The price is judged
   * by invariants 2, 4 and 5 in the service and not here: a schema that refused
   * a price too high would answer "Richiesta non valida" where the sentence has
   * to be "Real Fanta può arrivare a 205".
   */
  'auction.assign': {
    input: z.object({
      leagueId: z.number().int(),
      playerId: z.number().int(),
      fantaTeamId: z.number().int(),
      price: z.number().int().min(0),
    }),
    output: auctionState,
  },

  /** `Ctrl/Cmd+Z`: the last purchase, deleted for real. */
  'auction.undo': {
    input: z.object({ leagueId: z.number().int() }),
    output: auctionState,
  },

  /** The arrow of the call format. Null takes the turn away from everyone. */
  'auction.setTurn': {
    input: z.object({
      leagueId: z.number().int(),
      fantaTeamId: z.number().int().nullable(),
    }),
    output: auctionState,
  },

  /** Moves the league into revision. Incomplete rosters do not stop it. */
  'auction.close': {
    input: z.object({ leagueId: z.number().int() }),
    output: auctionState,
  },

  'auction.history': {
    input: z.object({ leagueId: z.number().int() }),
    output: z.array(logEntry),
  },

  'player.list': {
    input: z.object({ seasonId: z.string() }),
    output: z.object({
      seasonId: z.string(),
      /** Drives the FBref columns, per document 2 §4.4 and document 1 §6. */
      hasFbref: z.boolean(),
      /** Seasons with statistics, oldest first: what the selector offers. */
      statsSeasons: z.array(z.string()),
      /**
       * The last **completed** season, which is what the table shows until the
       * reader picks another. An auction is prepared in August, when the season
       * on screen has two matchdays in it: its FM and MV would say nothing, and
       * the "Pv ≥ 25 su 38" chip of document 2 §4.4 would select nobody.
       */
      defaultStatsSeason: z.string().nullable(),
      players: z.array(playerRow),
    }),
  },
} as const satisfies ContractMap

export type Channel = keyof typeof contracts
export type Input<C extends Channel> = z.infer<(typeof contracts)[C]['input']>
export type Output<C extends Channel> = z.infer<(typeof contracts)[C]['output']>

/**
 * Topics the main process pushes without being asked. Parallel to the channels
 * and typed the same way.
 *
 * Only one for now. `dataset.progress` is emitted by the import service of T7,
 * five times per run. `update.status` arrives with T20, from document 3 §8 —
 * inventing its shape here without reading that section would be guessing.
 */
export type EventMap = Record<string, z.ZodType>

export const events = {
  'dataset.progress': z.object({
    done: z.number().int(),
    total: z.number().int(),
    label: z.string(),
  }),
} as const satisfies EventMap

export type EventTopic = keyof typeof events
export type EventPayload<T extends EventTopic> = z.infer<(typeof events)[T]>
