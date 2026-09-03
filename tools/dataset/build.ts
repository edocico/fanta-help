import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { normalizeName, spelledOut } from '@shared/domain'
import {
  DATASET_FORMAT,
  FORMAT_VERSION,
  MANIFEST_FORMAT,
  dataset as datasetSchema,
  manifest as manifestSchema,
  type Dataset,
  type DatasetPlayer,
  type DatasetSource,
  type DatasetStat,
  type Manifest,
} from '@shared/dataset'
import { readQuotazioni, readStatistiche, type Statistica } from './fantacalcio'
import { readFbref, type FbrefRow } from './fbref'
import { readApiFootball } from './apifootball'
import { mapClubs, matchWithinClub } from './matching'

/**
 * The three stages of document 4 §2, end to end: read the listone and the
 * statistics, hang the history off the current season's identities, enrich it
 * with FBref and with the external identifiers if those files are there, and
 * write the dataset plus a report a person can read.
 *
 * Stages 2 and 3 are optional in the strong sense: **neither can fail the run**.
 * Everything they cannot do turns into a line of the report, because a player
 * with four empty columns is a working row and a stopped pipeline is not.
 *
 * The projection matters and is deliberate: the dataset describes the players in
 * the **most recent listone**, and nobody else. A player who left Serie A has no
 * row, because he cannot be bought. Statistics that belong to no one in the
 * listone are dropped — roughly 45% of the rows read.
 *
 * Usage:
 *   npm run dataset:build -- [--season 2026-27] [--version v2] [--note "…"]
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

// Overridable so the refusal paths can be exercised on a crafted input tree.
// A pipeline whose "or it is clean or it does not come out" has never been seen
// to fire is a promise, not a guarantee.
const INPUT = arg('input') ?? 'tools/dataset/input'
const OUTPUT = arg('output') ?? 'tools/dataset/output'
const OVERRIDES = arg('overrides') ?? 'tools/dataset/overrides.json'

/** `Quotazioni_Fantacalcio_Stagione_2026_27.xlsx` → kind and season. */
const FILE_PATTERN = /^(Quotazioni|Statistiche)_Fantacalcio_Stagione_(\d{4})_(\d{2})\.xlsx$/i

const overridesSchema = z.object({
  aliases: z
    .array(
      z.object({
        identityKey: z.string(),
        // Empty means "checked, this player genuinely has no history": it settles
        // a namesake without inventing a section the document does not describe.
        alsoKnownAs: z.array(z.string()),
        note: z.string().optional(),
      }),
    )
    .default([]),
  birthDates: z.record(z.string(), z.string()).default({}),
  externalIds: z
    .record(z.string(), z.object({ fbref: z.string().optional(), apiFootball: z.number().int().optional() }))
    .default({}),
  penaltyTakers: z.record(z.string(), z.array(z.string())).default({}),
})

type Overrides = z.infer<typeof overridesSchema>

interface Found {
  kind: 'quotazioni' | 'statistiche'
  seasonId: string
  file: string
}

function discover(dir: string): Found[] {
  return readdirSync(dir)
    .map((name) => {
      const match = FILE_PATTERN.exec(name)
      if (!match) return null
      const kind = match[1].toLowerCase() === 'quotazioni' ? ('quotazioni' as const) : ('statistiche' as const)
      return { kind, seasonId: `${match[2]}-${match[3]}`, file: join(dir, name) }
    })
    .filter((found): found is Found => found !== null)
    .sort((a, b) => a.seasonId.localeCompare(b.seasonId))
}

function digest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function readOverrides(): Overrides {
  // Absent and unreadable are different answers, and one catch for both would
  // turn a stray comma into "no manual decisions" — which reads exactly like a
  // file nobody has filled in yet. Document 4 §5 promises these survive every
  // regeneration; losing them silently breaks that promise where it is invisible.
  if (!existsSync(OVERRIDES)) return overridesSchema.parse({})

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(OVERRIDES, 'utf8'))
  } catch (error) {
    throw new Error(
      `${OVERRIDES} esiste ma non è JSON valido: ${error instanceof Error ? error.message : String(error)}.\n` +
        `Le decisioni manuali che contiene andrebbero perse senza che niente fallisca, quindi si ferma qui.`,
    )
  }
  const parsed = overridesSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `${OVERRIDES} non è valido:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    )
  }
  return parsed.data
}

/** Three letters from the club name, with the collision guard the day it matters. */
function teamCodes(names: string[]): Array<{ name: string; code: string }> {
  const teams = names.map((name) => ({ name, code: name.slice(0, 3).toUpperCase() }))
  const seen = new Map<string, string>()
  for (const team of teams) {
    const other = seen.get(team.code)
    if (other) {
      throw new Error(
        `sigla ambigua "${team.code}": la prendono sia ${other} sia ${team.name}. ` +
          `Le tre lettere non bastano più, serve una tabella di sigle.`,
      )
    }
    seen.set(team.code, team.name)
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name))
}

function nextVersion(dir: string): string {
  let highest = 0
  try {
    for (const name of readdirSync(dir)) {
      const match = /^v(\d+)\.json\.gz$/.exec(name)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
  } catch {
    /* the directory does not exist on the first run */
  }
  return `v${highest + 1}`
}

async function main(): Promise<void> {
  const found = discover(INPUT)
  const listoni = found.filter((f) => f.kind === 'quotazioni')
  if (listoni.length === 0) {
    throw new Error(`${INPUT}: nessun file Quotazioni_Fantacalcio_Stagione_<anno>_<anno>.xlsx`)
  }

  const seasonId = arg('season') ?? listoni[listoni.length - 1].seasonId
  const listone = listoni.find((f) => f.seasonId === seasonId)
  if (!listone) {
    throw new Error(
      `nessun listone per la stagione ${seasonId}. Presenti: ${listoni.map((l) => l.seasonId).join(', ')}`,
    )
  }
  const seasonDir = join(OUTPUT, seasonId)
  const version = arg('version') ?? nextVersion(seasonDir)
  const overrides = readOverrides()

  const manifestPath = join(OUTPUT, 'manifest.json')
  let current: Manifest = { format: MANIFEST_FORMAT, formatVersion: FORMAT_VERSION, seasons: [] }
  if (existsSync(manifestPath)) {
    // Read here, before a single byte is written, and not beside the update at the
  // end: a manifest that fails validation used to stop the run *after* the
  // dataset had already landed on disk, leaving an orphan .json.gz that no
  // manifest mentioned — while the error said it had stopped.
  //
  // Same reasoning as the overrides, with more at stake: a manifest that exists
    // and does not parse must not read as one that is not there yet. Starting from
    // empty would drop every season already published, and document 4 §6 has the
    // app compare `latest` against what it has installed — it would simply stop
    // being offered a season it once had.
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(
        `${manifestPath} esiste ma non è JSON valido: ${error instanceof Error ? error.message : String(error)}.\n` +
          `Riscriverlo da capo cancellerebbe le stagioni già pubblicate, quindi si ferma qui.`,
      )
    }
    const parsedManifest = manifestSchema.safeParse(raw)
    if (!parsedManifest.success) {
      throw new Error(
        `${manifestPath} esiste ma non supera il proprio schema:\n` +
          parsedManifest.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n') +
          `\nRiscriverlo da capo cancellerebbe le stagioni già pubblicate, quindi si ferma qui.`,
      )
    }
    current = parsedManifest.data
  }

  console.log(`Stagione ${seasonId}, versione ${version}`)
  console.log(`  listone     ${basename(listone.file)}`)

  const quotazioni = await readQuotazioni(listone.file)
  const sources: DatasetSource[] = [
    { kind: 'quotazioni', season: seasonId, file: basename(listone.file), sha256: digest(listone.file) },
  ]

  const statistiche = new Map<string, Statistica[]>()
  for (const file of found.filter((f) => f.kind === 'statistiche')) {
    console.log(`  statistiche ${basename(file.file)}`)
    statistiche.set(file.seasonId, await readStatistiche(file.file))
    sources.push({
      kind: 'statistiche',
      season: file.seasonId,
      file: basename(file.file),
      sha256: digest(file.file),
    })
  }

  // ── Identity ────────────────────────────────────────────────────────────────
  // Level 1 of document 4 §5, the one the verification found intact: the key is
  // `fc-<sourceId>` taken from the current listone, and the aliases fold former
  // ids onto it.
  const keyBySourceId = new Map<number, string>()
  for (const player of quotazioni) keyBySourceId.set(player.sourceId, `fc-${player.sourceId}`)

  const knownKeys = new Set(keyBySourceId.values())
  for (const alias of overrides.aliases) {
    if (!knownKeys.has(alias.identityKey)) {
      throw new Error(
        `${OVERRIDES}: l'alias punta a ${alias.identityKey}, che non è nel listone ${seasonId}. ` +
          `Un alias verso un giocatore inesistente non aggancia niente.`,
      )
    }
    for (const former of alias.alsoKnownAs) {
      const sourceId = Number(former.replace(/^fc-/, ''))
      if (!Number.isInteger(sourceId)) throw new Error(`${OVERRIDES}: alias illeggibile "${former}"`)
      keyBySourceId.set(sourceId, alias.identityKey)
    }
  }

  // birthDates, externalIds and penaltyTakers are not checked against the listone
  // the way aliases are, and the asymmetry is deliberate: overrides.json outlives a
  // season, so it legitimately carries keys for players who have since left. A typo
  // looks exactly the same as a departure, though, so they are counted and named
  // rather than dropped in silence.
  const stale = [
    ...Object.keys(overrides.birthDates),
    ...Object.keys(overrides.externalIds),
    ...Object.values(overrides.penaltyTakers).flat(),
  ].filter((key) => !knownKeys.has(key))
  if (stale.length > 0) {
    console.warn(
      `  ${OVERRIDES}: ${stale.length} chiavi non sono nel listone ${seasonId} e non hanno effetto: ` +
        `${[...new Set(stale)].join(', ')}\n` +
        `  Normale per chi ha lasciato la Serie A, un refuso se il giocatore c'è ancora.`,
    )
  }

  // ── History hung off those identities ───────────────────────────────────────
  // The name and the club of that season travel beside the row, and stage 2 is
  // why: FBref is matched inside the club, and the club that matters is the one
  // the player was at *that* season. The listone only knows where he is now, so
  // matching 2023-24 against it would look for half the league in the wrong squad.
  const history: Array<{ row: DatasetStat; name: string; team: string }> = []
  const withHistory = new Set<string>()
  let dropped = 0
  for (const [statSeason, rows] of statistiche) {
    for (const row of rows) {
      const identityKey = keyBySourceId.get(row.sourceId)
      if (!identityKey) {
        dropped++
        continue
      }
      if (statSeason !== seasonId) withHistory.add(identityKey)
      history.push({
        name: row.name,
        team: row.team,
        row: {
        identityKey,
        seasonId: statSeason,
        team: row.team,
        roleClassic: row.roleClassic,
        matchesRated: row.matchesRated,
        avgVote: row.avgVote,
        fantaAvg: row.fantaAvg,
        goals: row.goals,
        goalsConceded: row.goalsConceded,
        assists: row.assists,
        penaltiesTaken: row.penaltiesTaken,
        penaltiesScored: row.penaltiesScored,
        penaltiesMissed: row.penaltiesMissed,
        penaltiesSaved: row.penaltiesSaved,
        yellowCards: row.yellowCards,
        redCards: row.redCards,
        ownGoals: row.ownGoals,
        matchesPlayed: null,
        starts: null,
        minutes: null,
        cleanSheets: null,
        },
      })
    }
  }

  // ── No history: a real newcomer, or an id that moved? ───────────────────────
  // The only way the id-based join can be silently wrong. A player whose id moved
  // looks exactly like a newcomer, so his name is searched in the statistics.
  const settled = new Set(overrides.aliases.map((a) => a.identityKey))
  const statNames = new Map<string, Map<number, string>>()
  for (const [statSeason, rows] of statistiche) {
    if (statSeason === seasonId) continue
    for (const row of rows) {
      const normalized = normalizeName(row.name)
      const byId = statNames.get(normalized) ?? new Map<number, string>()
      byId.set(row.sourceId, `${statSeason} come "${row.name}" (${row.team})`)
      statNames.set(normalized, byId)
    }
  }

  const undecided: string[] = []
  for (const player of quotazioni) {
    const key = `fc-${player.sourceId}`
    if (withHistory.has(key) || settled.has(key)) continue
    const matches = statNames.get(normalizeName(player.name))
    if (!matches) continue
    const others = [...matches].filter(([id]) => keyBySourceId.get(id) !== key)
    if (others.length === 0) continue
    undecided.push(
      `  "${player.name}" (${key}, ${player.team}) non ha storico, ma il nome compare con altri Id:\n` +
        others.map(([id, where]) => `      fc-${id} → ${where}`).join('\n'),
    )
  }

  // ── Stage 2: FBref ──────────────────────────────────────────────────────────
  // Matched per season, inside the club, exactly as document 4 §5 prescribes —
  // and the club is the one of *that* season, taken from the statistiche row.
  const fbref = readFbref(join(INPUT, 'fbref'))
  const fbrefNotes = [...fbref.problems]
  const fbrefUnmatched: string[] = []
  const fbrefLinked = new Set<string>()
  const fbrefEligible = new Set<string>()
  const birthYears = new Map<string, number>()
  /**
   * The other half of T6, and the whole of T14b: the name a player is actually
   * called by.
   *
   * Twin of `birthYears` on purpose, because it is the same kind of thing — a
   * fact about the *person*, not about his season, and the only two the stage
   * writes onto the player rather than onto a statistics row. It inherits the
   * useful property for free: `fbref.seasons` is sorted ascending, so the last
   * write wins and what survives is the most recent spelling.
   */
  const fullNames = new Map<string, string>()
  let enrichedRows = 0
  let aggregated = 0

  /**
   * The year out of a hand-written birth date, or null when there is none.
   *
   * The shape of the test matters more than it looks: `Number('')` is 0 and
   * `Number.isInteger(0)` is true, so an absent override used to answer "year
   * zero". That was harmless while the year only broke ties — zero tied with
   * nobody — and became a veto that refused every candidate the moment the year
   * was allowed to say no on its own.
   */
  const yearOf = (key: string): number | null => {
    const raw = (overrides.birthDates[key] ?? '').slice(0, 4)
    return /^\d{4}$/.test(raw) ? Number(raw) : null
  }

  const total = (parts: FbrefRow[], field: 'matchesPlayed' | 'starts' | 'minutes' | 'cleanSheets'): number | null => {
    const values = parts.map((part) => part[field]).filter((value): value is number => value !== null)
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)
  }

  for (const season of fbref.seasons) {
    const rows = history.filter((entry) => entry.row.seasonId === season.seasonId)
    if (rows.length === 0) {
      fbrefNotes.push(`${season.seasonId}: FBref copre la stagione, le statistiche no. Ignorata.`)
      continue
    }

    const clubs = mapClubs(
      [...new Set(rows.map((entry) => entry.team))],
      season.rows.map((row) => row.team),
    )
    // A club that fails to map costs its whole squad, which is too large a hole
    // to leave unnamed: one line per club, not one per player.
    for (const club of clubs.unmapped) {
      fbrefNotes.push(`${season.seasonId}: il club FBref "${club}" non corrisponde a nessuna squadra delle statistiche`)
    }
    for (const club of clubs.ambiguous) fbrefNotes.push(`${season.seasonId}: club FBref ambiguo, ${club}`)

    // Indexed because the twin lookup below spans rows the club mapping threw
    // away, and two objects have to be told apart after being copied.
    const indexed = season.rows.map((row, index) => ({ ...row, index }))
    const candidates = indexed
      .map((row) => ({ ...row, team: clubs.byForeign.get(row.team) ?? '' }))
      .filter((row) => row.team !== '')

    // Over *every* row of the season, not just the ones whose club mapped. The
    // club a player left may be one no listone player ever played for, and it is
    // his minutes that would go missing — the half of the season nobody notices.
    const byName = new Map<string, typeof indexed>()
    for (const row of indexed) {
      const key = normalizeName(row.name)
      byName.set(key, [...(byName.get(key) ?? []), row])
    }

    const claims: Array<{ entry: (typeof rows)[number]; to: (typeof candidates)[number] }> = []
    for (const entry of rows) {
      fbrefEligible.add(entry.row.identityKey)
      const outcome = matchWithinClub(entry, candidates, yearOf(entry.row.identityKey))
      if (outcome.kind !== 'matched') {
        fbrefUnmatched.push(
          `${entry.name} (${entry.team}, ${season.seasonId}): ` +
            (outcome.kind === 'ambiguous' ? `ambiguo fra ${outcome.between.join(' / ')}` : 'nessuna corrispondenza'),
        )
        continue
      }
      claims.push({ entry, to: outcome.to })
    }

    // Two players of the listone cannot be the same row of the export. When both
    // claim it the match is wrong for at least one of them and nothing here says
    // which, so neither keeps it. Each match is decided on its own, so without
    // this the collision is invisible: both sides look like clean matches.
    const byRow = new Map<number, typeof claims>()
    for (const claim of claims) byRow.set(claim.to.index, [...(byRow.get(claim.to.index) ?? []), claim])

    for (const group of byRow.values()) {
      if (group.length > 1) {
        fbrefNotes.push(
          `${season.seasonId}: "${group[0].to.name}" è reclamato da ` +
            `${group.map((claim) => `${claim.entry.name} (${claim.entry.row.identityKey})`).join(' e ')}, ` +
            `nessuno dei due agganciato`,
        )
        for (const claim of group) {
          fbrefUnmatched.push(
            `${claim.entry.name} (${claim.entry.team}, ${season.seasonId}): conteso con un altro giocatore del listone`,
          )
        }
        continue
      }
      const { entry, to } = group[0]

      // Somebody who changed club inside Serie A has one FBref row per squad and
      // one single row in the statistiche, so matching inside his club finds only
      // part of his minutes. The parts are added back — but only when the birth
      // year says they are the same person. Marcus and Khéphren Thuram are exactly
      // what this must never fuse, and 1997 against 2001 keeps them apart.
      const namesakes = (byName.get(normalizeName(to.name)) ?? []).filter((row) => row.index !== to.index)
      const twins = namesakes.filter((row) => row.birthYear !== null && row.birthYear === to.birthYear)
      if (twins.length > 0) aggregated++
      // Refusing to add is the safe half of the decision; saying so is the other
      // half. Without it, a season cut down to one club's worth of minutes reads
      // exactly like a season actually spent there.
      if (namesakes.length > twins.length) {
        fbrefNotes.push(
          `${season.seasonId}: "${to.name}" compare anche in ${namesakes
            .filter((row) => !twins.includes(row))
            .map((row) => row.team)
            .join(', ')}, non sommato — anno di nascita mancante o diverso`,
        )
      }
      const parts = [to, ...twins]

      entry.row.matchesPlayed = total(parts, 'matchesPlayed')
      entry.row.starts = total(parts, 'starts')
      entry.row.minutes = total(parts, 'minutes')
      entry.row.cleanSheets = total(parts, 'cleanSheets')
      if (to.birthYear !== null) birthYears.set(entry.row.identityKey, to.birthYear)
      // Unconditional where the year is not, because a name is never absent from
      // an FBref row — `mergeTable` skips a row that has none — while `Born` is a
      // column an export can lose, and has.
      fullNames.set(entry.row.identityKey, to.name)
      fbrefLinked.add(entry.row.identityKey)
      enrichedRows++
    }
  }
  const hasFbref = enrichedRows > 0

  // Document 4 §4 gives `sources` one job: "fra sei mesi, davanti a un dato
  // strano, poter dire con certezza da quale file veniva". The four columns this
  // stage writes are exactly the kind of strange number that gets looked up, so
  // the exports that produced them are fingerprinted like the others.
  for (const season of fbref.seasons) {
    for (const file of season.files) {
      sources.push({
        kind: 'fbref',
        season: season.seasonId,
        file,
        sha256: digest(join(INPUT, 'fbref', file)),
      })
    }
  }

  // ── Stage 3: the external identifiers ───────────────────────────────────────
  // Against the current listone and its clubs, because what this feeds is the
  // live layer of document 4 §7, which only ever asks about players you can buy.
  const api = readApiFootball(join(INPUT, 'api-football'))
  const apiNotes = [...api.problems]
  const apiUnmatched: string[] = []
  const apiIds = new Map<string, number>()

  if (api.players.length > 0) {
    const clubs = mapClubs(
      [...new Set(quotazioni.map((player) => player.team))],
      api.players.map((player) => player.team),
    )
    for (const club of clubs.unmapped) apiNotes.push(`il club "${club}" non corrisponde a nessuna squadra del listone`)
    for (const club of clubs.ambiguous) apiNotes.push(`club ambiguo, ${club}`)

    const candidates = api.players
      .map((player) => ({ ...player, team: clubs.byForeign.get(player.team) ?? '' }))
      .filter((player) => player.team !== '')

    // A club of the listone with no roster file saved produces thirty lines of
    // "nessuna corrispondenza" and never says why. One line, like the FBref side.
    const covered = new Set(candidates.map((player) => player.team))
    for (const team of [...new Set(quotazioni.map((player) => player.team))].sort()) {
      if (!covered.has(team)) apiNotes.push(`nessuna rosa salvata per ${team}: i suoi giocatori restano senza id`)
    }

    for (const player of quotazioni) {
      const key = `fc-${player.sourceId}`
      const outcome = matchWithinClub(player, candidates, yearOf(key) ?? birthYears.get(key) ?? null)
      if (outcome.kind === 'matched') apiIds.set(key, outcome.to.apiFootballId)
      else {
        apiUnmatched.push(
          `${player.name} (${player.team}): ` +
            (outcome.kind === 'ambiguous' ? `ambiguo fra ${outcome.between.join(' / ')}` : 'nessuna corrispondenza'),
        )
      }
    }

    // Same reasoning as the FBref rows, and a sharper consequence: two players
    // sharing one apiFootball id means one injury lights up two rows in the app.
    const byId = new Map<number, string[]>()
    for (const [key, id] of apiIds) byId.set(id, [...(byId.get(id) ?? []), key])
    for (const [id, keys] of byId) {
      if (keys.length === 1) continue
      apiNotes.push(`l'id ${id} è reclamato da ${keys.join(' e ')}, nessuno dei due agganciato`)
      for (const key of keys) {
        apiIds.delete(key)
        apiUnmatched.push(`${key}: conteso con un altro giocatore del listone`)
      }
    }
  }

  /**
   * Manual wins, here as with the penalty takers: overrides.json is a decision,
   * a name match is an inference. Merged and not replaced, so a hand-written
   * fbref id can sit beside an inferred apiFootball one.
   */
  const externalIdsFor = (key: string): DatasetPlayer['externalIds'] => {
    const manual = overrides.externalIds[key]
    const inferred = apiIds.get(key)
    if (manual === undefined && inferred === undefined) return undefined
    const merged = { ...(inferred === undefined ? {} : { apiFootball: inferred }), ...manual }
    return Object.keys(merged).length === 0 ? undefined : merged
  }

  // ── Penalty takers ──────────────────────────────────────────────────────────
  const pastSeasons = [...statistiche.keys()].filter((s) => s !== seasonId).sort()
  const lastPast = pastSeasons[pastSeasons.length - 1]
  const derivedTakers = new Set<string>()
  for (const row of statistiche.get(lastPast) ?? []) {
    if (row.penaltiesTaken >= 3) {
      const key = keyBySourceId.get(row.sourceId)
      if (key) derivedTakers.add(key)
    }
  }
  const manualTakers = new Set(Object.values(overrides.penaltyTakers).flat())

  // ── Players ─────────────────────────────────────────────────────────────────
  const players: DatasetPlayer[] = quotazioni
    .map((row) => {
      const identityKey = `fc-${row.sourceId}`
      const manual = manualTakers.has(identityKey)
      return {
        sourceId: row.sourceId,
        identityKey,
        name: row.name,
        fullName: fullNames.get(identityKey) ?? null,
        team: row.team,
        roleClassic: row.roleClassic,
        rolesMantra: row.rolesMantra,
        qtClassicInitial: row.qtClassicInitial,
        qtClassicCurrent: row.qtClassicCurrent,
        qtMantraInitial: row.qtMantraInitial,
        qtMantraCurrent: row.qtMantraCurrent,
        fvmClassic: row.fvmClassic,
        fvmMantra: row.fvmMantra,
        birthDate: overrides.birthDates[identityKey] ?? null,
        birthYear: birthYears.get(identityKey) ?? null,
        penaltyTaker: manual || derivedTakers.has(identityKey),
        penaltyTakerSource: manual ? ('manual' as const) : derivedTakers.has(identityKey) ? ('derived' as const) : null,
        externalIds: externalIdsFor(identityKey),
      }
    })
    // Sorted so that two runs on the same inputs differ only in `generatedAt`.
    // Document 4 §4 buys a readable diff with this format; an unstable order
    // would throw that away.
    .sort((a, b) => a.sourceId - b.sourceId)

  const stats: DatasetStat[] = history
    .map((entry) => entry.row)
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.seasonId.localeCompare(b.seasonId))

  const built: Dataset = {
    format: DATASET_FORMAT,
    formatVersion: FORMAT_VERSION,
    seasonId,
    version,
    generatedAt: new Date().toISOString(),
    hasFbref,
    // What this flag promises the app is the live layer's hook, so it answers
    // for the apiFootball id alone: a dataset carrying only fbref ids would
    // switch the injury column on and have nothing to put in it.
    hasExternalIds: players.some((player) => player.externalIds?.apiFootball !== undefined),
    sources,
    serieATeams: teamCodes([...new Set(quotazioni.map((p) => p.team))]),
    players,
    stats,
  }

  // The pipeline validates its own output with the schema T7 will use to read it:
  // a shape that fails here never reaches the repository.
  const valid = datasetSchema.safeParse(built)
  if (!valid.success) {
    throw new Error(
      'il dataset costruito non supera il proprio schema:\n' +
        valid.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    )
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const pad = (n: number): string => String(n).padStart(4)
  // Counts and a fixed noun do not agree in Italian: "1 rigoristi" is not a
  // label. The lines that can legitimately read 1 are phrased around it.
  const takers = players.filter((p) => p.penaltyTaker).length
  const manual = players.filter((p) => p.penaltyTakerSource === 'manual').length

  // Document 4 §5 draws this block as two lines. It grows a second line only
  // where a stage actually ran and has a number worth the space.
  const fbrefFiles = fbref.seasons.reduce((count, season) => count + season.files.length, 0)
  // Conditioned on the files being there, not on the stage having succeeded. A
  // stage that ran and matched nobody is the case the report matters most for,
  // and "non eseguito" above a list of what it failed to match is a lie.
  // The number T14b is measured by, and the reason it gets its own line rather
  // than hiding inside "collegati": a player can be linked — his four columns
  // filled — and still be called the same thing the listone calls him, in which
  // case the search gains nothing. `named` says how many have a second name at
  // all; `renamed` says for how many that name is one you could type instead.
  const named = players.filter((p) => p.fullName !== null).length
  const renamed = players.filter((p) => spelledOut(p.name, p.fullName) !== null).length
  const fbrefLines =
    fbref.seasons.length > 0
      ? [
          `FBref            ${fbrefLinked.size}/${fbrefEligible.size} collegati, ` +
            `${fbrefEligible.size - fbrefLinked.size} senza corrispondenza`,
          `                 ${enrichedRows} ${enrichedRows === 1 ? 'riga arricchita' : 'righe arricchite'} da ${fbrefFiles} file` +
            (aggregated > 0 ? `, ${aggregated} con due squadre nella stagione, minuti sommati` : ''),
          `                 ${named} ${named === 1 ? 'nome per esteso' : 'nomi per esteso'}, ` +
            `${renamed === 1 ? '1 diverso' : `${renamed} diversi`} dal nome del listone`,
        ]
      : ['FBref            non eseguito']
  const apiLines =
    api.players.length > 0
      ? [
          `API-Football     ${apiIds.size}/${players.length} collegati, ` +
            `${players.length - apiIds.size} senza corrispondenza`,
        ]
      : ['API-Football     non eseguito']
  const lines = [
    `Riconciliazione ${seasonId} ${version}`,
    '─'.repeat(26),
    `${pad(players.length)} giocatori nel listone`,
    `${pad(withHistory.size)} con storico agganciato per sourceId`,
    `${pad(0)} con storico agganciato per nome + anno di nascita (livello 2, non serve)`,
    `${pad(players.length - withHistory.size)} senza storico: esordienti o nuovi arrivi`,
    `${pad(undecided.length)} da decidere: ${undecided.length === 1 ? 'richiede' : 'richiedono'} una voce in overrides.json`,
    '',
    `${pad(stats.length)} righe di statistica tenute, ${dropped} scartate perché fuori dal listone`,
    `${pad(built.serieATeams.length)} squadre di Serie A`,
    `${pad(takers)} ${takers === 1 ? 'rigorista' : 'rigoristi'}, ${manual} per designazione manuale`,
    '',
    ...fbrefLines,
    ...apiLines,
  ]

  /**
   * A list cut at twelve says it was cut. Ten lines under a heading and nothing
   * else reads as a run with ten problems, which is the one thing a report of
   * what went wrong must never do.
   */
  const detail = (title: string, entries: string[]): string[] => {
    if (entries.length === 0) return []
    const shown = entries.slice(0, 12).map((entry) => `  ${entry}`)
    if (entries.length > 12) shown.push(`  … e altri ${entries.length - 12}, non elencati`)
    return ['', title, ...shown]
  }
  lines.push(...detail('FBREF, NOTE', fbrefNotes))
  lines.push(...detail('FBREF, SENZA CORRISPONDENZA', fbrefUnmatched))
  lines.push(...detail('API-FOOTBALL, NOTE', apiNotes))
  lines.push(...detail('API-FOOTBALL, SENZA CORRISPONDENZA', apiUnmatched))
  if (undecided.length > 0) lines.push('', 'DA DECIDERE', ...undecided)
  const report = lines.join('\n')
  console.log('\n' + report + '\n')

  if (undecided.length > 0) {
    throw new Error(
      `${undecided.length} identità da decidere. Il dataset non viene scritto: o è pulito o non esce.\n` +
        `Per ognuna, in ${OVERRIDES}, o l'alias verso il vecchio Id o un alias vuoto se è un omonimo.`,
    )
  }

  // ── Writing ─────────────────────────────────────────────────────────────────
  mkdirSync(seasonDir, { recursive: true })
  const payload = gzipSync(Buffer.from(JSON.stringify(built), 'utf8'))
  const datasetPath = join(seasonDir, `${version}.json.gz`)
  writeFileSync(datasetPath, payload)
  writeFileSync(join(seasonDir, `${version}.txt`), report + '\n')

  const entry = {
    version,
    publishedAt: new Date().toISOString().slice(0, 10),
    playerCount: players.length,
    hasFbref: built.hasFbref,
    hasExternalIds: built.hasExternalIds,
    url: `${seasonId}/${version}.json.gz`,
    sha256: createHash('sha256').update(payload).digest('hex'),
    ...(arg('note') ? { note: arg('note') as string } : {}),
  }
  const byNumber = (a: { version: string }, b: { version: string }): number =>
    Number(a.version.slice(1)) - Number(b.version.slice(1))
  const season = current.seasons.find((s) => s.seasonId === seasonId)
  if (season) {
    season.versions = [...season.versions.filter((v) => v.version !== version), entry].sort(byNumber)
    // The highest, never simply the one just built: rebuilding v1 after v3 would
    // otherwise offer the app an older dataset as an update.
    season.latest = season.versions[season.versions.length - 1].version
  } else {
    current.seasons.push({
      seasonId,
      label: `Serie A ${seasonId.slice(0, 4)}/${seasonId.slice(5)}`,
      latest: version,
      versions: [entry],
    })
  }
  current.seasons.sort((a, b) => a.seasonId.localeCompare(b.seasonId))
  writeFileSync(manifestPath, JSON.stringify(manifestSchema.parse(current), null, 2) + '\n')

  console.log(`scritto ${datasetPath}  ${(payload.length / 1024).toFixed(0)} KB`)
  console.log(`scritto ${join(seasonDir, `${version}.txt`)}`)
  console.log(`aggiornato ${manifestPath}`)
}

main().catch((error: unknown) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})
