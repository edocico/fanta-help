import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { normalizeName } from '@shared/domain'
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

/**
 * Stage 1 of document 4, end to end: read the listone and the statistics, hang
 * the history off the current season's identities, and write the dataset plus a
 * report a person can read.
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
    .record(z.string(), z.object({ fbref: z.string().optional(), apiFootball: z.number().optional() }))
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
  const stats: DatasetStat[] = []
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
      stats.push({
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
        penaltyTaker: manual || derivedTakers.has(identityKey),
        penaltyTakerSource: manual ? ('manual' as const) : derivedTakers.has(identityKey) ? ('derived' as const) : null,
        externalIds: overrides.externalIds[identityKey],
      }
    })
    // Sorted so that two runs on the same inputs differ only in `generatedAt`.
    // Document 4 §4 buys a readable diff with this format; an unstable order
    // would throw that away.
    .sort((a, b) => a.sourceId - b.sourceId)

  stats.sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.seasonId.localeCompare(b.seasonId))

  const built: Dataset = {
    format: DATASET_FORMAT,
    formatVersion: FORMAT_VERSION,
    seasonId,
    version,
    generatedAt: new Date().toISOString(),
    hasFbref: false,
    hasExternalIds: Object.keys(overrides.externalIds).length > 0,
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
  const lines = [
    `Riconciliazione ${seasonId} ${version}`,
    '─'.repeat(26),
    `${pad(players.length)} giocatori nel listone`,
    `${pad(withHistory.size)} con storico agganciato per sourceId`,
    `${pad(0)} con storico agganciato per nome + data di nascita (livello 2, non serve)`,
    `${pad(players.length - withHistory.size)} senza storico: esordienti o nuovi arrivi`,
    `${pad(undecided.length)} da decidere: ${undecided.length === 1 ? 'richiede' : 'richiedono'} una voce in overrides.json`,
    '',
    `${pad(stats.length)} righe di statistica tenute, ${dropped} scartate perché fuori dal listone`,
    `${pad(built.serieATeams.length)} squadre di Serie A`,
    `${pad(takers)} ${takers === 1 ? 'rigorista' : 'rigoristi'}, ${manual} per designazione manuale`,
    '',
    'FBref            non eseguito, è lo stadio facoltativo di T6',
    'API-Football     non eseguito',
  ]
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
