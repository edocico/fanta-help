import { normalizeName } from '@shared/domain'
import { headerKey, readSheet, type CellValue } from './xlsx'

/**
 * The check the roadmap puts in front of every line of T5:
 *
 *   «verificare l'ipotesi che gli Id del listone siano stabili tra stagioni,
 *    confrontando due listoni consecutivi. Se cade, cambia la strategia di
 *    riconciliazione.»
 *
 * What it does *not* decide is the shape of `identity_key`. Document 1 settles
 * that: the key is always `fc-<sourceId>`, because the quotazioni file carries no
 * birth dates and the XLSX fallback import must be able to generate the key from
 * that file alone. So the three levels of document 4 §5 are not competing key
 * formats — they are ways of deciding which *past* rows belong to the key the
 * current listone gives a player. Past rows get rewritten onto today's key, which
 * is exactly what `alsoKnownAs` in overrides.json records.
 *
 * What hangs on the answer, then, is how the pipeline attaches three seasons of
 * statistics. Level 1 is one integer comparison. Level 2 needs birth dates, which
 * come from FBref — that is T6, a task that comes *after* this one.
 *
 * Takes two or more listoni in chronological order. More than two is worth the
 * trouble: with only a consecutive pair, a player who leaves Serie A and returns
 * a year later reads as "gone" in the first comparison and "new" in the second,
 * and is never tested — while being the case most likely to have lost its Id,
 * having been dropped from the listone and re-added.
 *
 * Uso:
 *   npm run dataset:verify-ids -- <più-vecchio.xlsx> … <più-recente.xlsx>
 */

interface Entry {
  id: number
  name: string
  normalized: string
  team: string
}

interface Listone {
  file: string
  entries: Entry[]
  byId: Map<number, Entry>
  /** Only names occurring once. A repeated name cannot be matched by name. */
  byName: Map<string, Entry>
  repeated: Set<string>
}

/** One player followed across the files, by normalised name. */
interface Track {
  name: string
  /** File indices where the name appears, ascending. */
  at: number[]
  /** The Id carried at each of those appearances. */
  ids: number[]
  teams: string[]
}

interface Reuse {
  id: number
  names: string[]
}

export interface Tally {
  /** Names seen in at least two listoni: the only ones that say anything. */
  comparable: number
  /** Names seen in exactly one listone. Not evidence either way. */
  singleSeason: number
  /** Present without interruption, same Id throughout. */
  held: Track[]
  /** Present without interruption, Id changed along the way. */
  changed: Track[]
  /** Absent in between and back later, Id survived the gap. */
  returnedHeld: Track[]
  /** Absent in between and back later, different Id on return. */
  returnedChanged: Track[]
  /** One Id, two names with nothing in common: almost certainly two people. */
  recycled: Reuse[]
  /** One Id, two names sharing a word: almost certainly one person respelled. */
  respelled: Reuse[]
  /** Names repeated inside some listone, excluded from every count above. */
  ambiguous: string[]
  /** Players in the most recent listone the check could say something about. */
  coveredInLatest: number
  latestTotal: number
}

export type Level = 'source-id' | 'name-birthdate' | 'undecided'

export interface Verdict {
  level: Level
  reason: string
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function text(row: Record<string, CellValue>, key: string): string {
  const value = row[headerKey(key)]
  return value === null || value === undefined ? '' : String(value).trim()
}

async function load(file: string): Promise<Listone> {
  const sheet = await readSheet(file, ['Id', 'Nome', 'Squadra'])

  const entries: Entry[] = []
  let skipped = 0
  sheet.rows.forEach((row) => {
    const id = Number(text(row, 'Id'))
    const name = text(row, 'Nome')
    if (!Number.isInteger(id) || name === '') {
      skipped++
      return
    }
    entries.push({ id, name, normalized: normalizeName(name), team: text(row, 'Squadra') })
  })

  if (skipped > 0) {
    console.warn(
      `  ${file}: ${skipped} ${plural(skipped, 'riga', 'righe')} senza Id o senza Nome, ` +
        `${plural(skipped, 'ignorata', 'ignorate')}`,
    )
  }

  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.normalized, (counts.get(e.normalized) ?? 0) + 1)
  const repeated = new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name))

  return {
    file,
    entries,
    byId: new Map(entries.map((e) => [e.id, e])),
    byName: new Map(entries.filter((e) => !repeated.has(e.normalized)).map((e) => [e.normalized, e])),
    repeated,
  }
}

/** Words shared by every spelling an Id has carried. Empty means: different people. */
function commonWords(names: string[]): Set<string> {
  const sets = names.map((n) => new Set(normalizeName(n).split(' ').filter(Boolean)))
  return sets.reduce((acc, s) => new Set([...acc].filter((w) => s.has(w))))
}

function compare(listoni: Listone[]): Tally {
  const ambiguous = new Set<string>()
  for (const l of listoni) for (const name of l.repeated) ambiguous.add(name)

  const tracks = new Map<string, Track>()
  listoni.forEach((listone, index) => {
    for (const [normalized, entry] of listone.byName) {
      if (ambiguous.has(normalized)) continue
      const track = tracks.get(normalized) ?? { name: entry.name, at: [], ids: [], teams: [] }
      track.name = entry.name // the most recent spelling wins
      track.at.push(index)
      track.ids.push(entry.id)
      track.teams.push(entry.team)
      tracks.set(normalized, track)
    }
  })

  const tally: Tally = {
    comparable: 0,
    singleSeason: 0,
    held: [],
    changed: [],
    returnedHeld: [],
    returnedChanged: [],
    recycled: [],
    respelled: [],
    ambiguous: [...ambiguous].sort(),
    coveredInLatest: 0,
    latestTotal: listoni[listoni.length - 1].entries.length,
  }

  for (const track of tracks.values()) {
    if (track.at.length < 2) {
      tally.singleSeason++
      continue
    }
    tally.comparable++
    const span = track.at[track.at.length - 1] - track.at[0] + 1
    const continuous = span === track.at.length
    const stable = track.ids.every((id) => id === track.ids[0])

    if (continuous && stable) tally.held.push(track)
    else if (continuous) tally.changed.push(track)
    else if (stable) tally.returnedHeld.push(track)
    else tally.returnedChanged.push(track)
  }

  // Walked over the Ids, not over the name matches: an Id handed to someone else
  // shows up precisely where the name match fails, so a name-first scan misses it.
  const namesById = new Map<number, Map<string, string>>()
  for (const listone of listoni) {
    for (const entry of listone.entries) {
      const seen = namesById.get(entry.id) ?? new Map<string, string>()
      seen.set(entry.normalized, entry.name)
      namesById.set(entry.id, seen)
    }
  }
  for (const [id, seen] of namesById) {
    if (seen.size < 2) continue
    const names = [...seen.values()]
    if (commonWords(names).size > 0) tally.respelled.push({ id, names })
    else tally.recycled.push({ id, names })
  }

  const latest = listoni[listoni.length - 1]
  for (const entry of latest.entries) {
    const track = tracks.get(entry.normalized)
    if (track && track.at.length >= 2) tally.coveredInLatest++
  }

  return tally
}

/**
 * How much Id churn a season may bring before level 1 stops being worth it.
 *
 * Every changed Id is one alias line in overrides.json: written by hand, and
 * permanent. At 1% of some 600 players that is six lines a season and the file
 * stays readable for years; at 5% it would be thirty a season, and a hundred and
 * fifty after five.
 *
 * Measured over four real listoni, 2023-24 through 2026-27: 0 out of 589. The
 * margin is enormous, so this threshold is not judging today's data — it is there
 * to catch the season Fantacalcio.it changes its mind.
 */
const TOLERATED_ALIAS_RATE = 0.01

/**
 * Turns the counts into the decision T5 is waiting for: which level of document 4
 * §5 attaches past statistics to the key the current listone gives a player.
 *
 * One half is not a judgement call and is decided here. The other half is, and is
 * left to you — see the TODO.
 */
export function judge(tally: Tally): Verdict {
  if (tally.recycled.length > 0) {
    return {
      level: 'name-birthdate',
      reason:
        `${tally.recycled.length} Id ${plural(tally.recycled.length, 'riusato', 'riusati')} ` +
        `da giocatori diversi. Non è una questione di quantità: agganciare lo storico per Id ` +
        `darebbe a qualcuno le statistiche di un altro, e sarebbe indistinguibile da un dato vero.`,
    }
  }

  const moved = tally.changed.length + tally.returnedChanged.length
  const churn = tally.comparable === 0 ? 1 : moved / tally.comparable

  if (churn <= TOLERATED_ALIAS_RATE) {
    return {
      level: 'source-id',
      reason:
        `${moved} Id ${plural(moved, 'cambiato', 'cambiati')} su ${tally.comparable} ` +
        `confrontabili (${(churn * 100).toFixed(1)}%), di cui ${tally.returnedChanged.length} ` +
        `al rientro. Sotto la soglia fissata a ${(TOLERATED_ALIAS_RATE * 100).toFixed(0)}%: lo storico ` +
        `si aggancia per Id, e gli scarti stanno negli alias di overrides.json.`,
    }
  }

  return {
    level: 'name-birthdate',
    reason:
      `${moved} Id ${plural(moved, 'cambiato', 'cambiati')} su ${tally.comparable} ` +
      `confrontabili (${(churn * 100).toFixed(1)}%), sopra la soglia fissata a ` +
      `${(TOLERATED_ALIAS_RATE * 100).toFixed(0)}%. Tenere il passo a mano con gli alias ` +
      `costerebbe più che agganciare per nome e data di nascita.`,
  }
}

function report(listoni: Listone[], tally: Tally, verdict: Verdict): void {
  const pad = (n: number): string => String(n).padStart(5)
  const trail = (t: Track): string =>
    t.at.map((index, i) => `${index + 1}:${t.ids[i]}`).join(' → ')

  const lines = ['', 'Verifica di stabilità degli Id', '──────────────────────────────']
  listoni.forEach((l, i) => lines.push(`${i + 1}  ${l.file}  —  ${l.entries.length} giocatori`))

  lines.push(
    '',
    `${pad(tally.comparable)} nomi presenti in almeno due listoni, gli unici che dicono qualcosa`,
    `${pad(tally.singleSeason)} nomi presenti in un listone solo`,
    `${pad(tally.ambiguous.length)} ${plural(tally.ambiguous.length, 'nome ripetuto', 'nomi ripetuti')} ` +
      `dentro un listone, ${plural(tally.ambiguous.length, 'escluso', 'esclusi')}`,
    '',
    'PRESENZA CONTINUA',
    `${pad(tally.held.length)} Id invariato`,
    `${pad(tally.changed.length)} Id cambiato        serve un alias`,
    '',
    listoni.length < 3
      ? 'RIENTRI                non misurabili: con due soli listoni non esiste un "in mezzo"'
      : 'RIENTRI                assenti in mezzo, poi tornati',
    ...(listoni.length < 3
      ? []
      : [
          `${pad(tally.returnedHeld.length)} Id sopravvissuto al vuoto`,
          `${pad(tally.returnedChanged.length)} Id nuovo al rientro    serve un alias`,
        ]),
    '',
    'ID RIUSATI',
    `${pad(tally.recycled.length)} su nomi senza niente in comune   riciclato: rompe l'aggancio per Id`,
    `${pad(tally.respelled.length)} su nomi con una parola in comune  probabile cambio di grafia`,
  )

  const detail = (title: string, tracks: Track[]): void => {
    if (tracks.length === 0) return
    lines.push('', title)
    for (const t of tracks) lines.push(`  "${t.name}"  ${trail(t)}`)
  }
  detail('ID CAMBIATI IN PRESENZA CONTINUA', tally.changed)
  detail('ID CAMBIATI AL RIENTRO', tally.returnedChanged)

  if (tally.recycled.length > 0) {
    lines.push('', 'ID RICICLATI')
    for (const r of tally.recycled) lines.push(`  ${r.id}: ${r.names.map((n) => `"${n}"`).join(', ')}`)
  }
  if (tally.respelled.length > 0) {
    lines.push('', 'PROBABILI CAMBI DI GRAFIA  (stesso Id, guardali a occhio)')
    for (const r of tally.respelled) lines.push(`  ${r.id}: ${r.names.map((n) => `"${n}"`).join(', ')}`)
  }
  if (tally.ambiguous.length > 0) lines.push('', `NOMI RIPETUTI  ${tally.ambiguous.join(', ')}`)

  const uncovered = tally.latestTotal - tally.coveredInLatest
  lines.push(
    '',
    'COPERTURA',
    `  ${tally.coveredInLatest} dei ${tally.latestTotal} giocatori del listone più recente hanno`,
    `  uno storico confrontabile. Sugli altri ${uncovered} questa verifica non dice`,
    `  niente: sono esordienti, nuovi arrivi o nomi ambigui.`,
    '',
    `VERDETTO  ${verdict.level}`,
    `          ${verdict.reason}`,
    '',
  )
  console.log(lines.join('\n'))
}

async function main(): Promise<void> {
  const files = process.argv.slice(2)
  if (files.length < 2) {
    console.error(
      'Servono almeno due listoni, in ordine cronologico dal più vecchio al più recente.\n' +
        '  npm run dataset:verify-ids -- <2023-24.xlsx> <2024-25.xlsx> <2025-26.xlsx>\n' +
        'Con tre o più si misurano anche i rientri, che con due sono invisibili.',
    )
    process.exitCode = 1
    return
  }

  const listoni = await Promise.all(files.map(load))
  const tally = compare(listoni)
  const verdict = judge(tally)
  report(listoni, tally, verdict)

  // Exit 1 on 'undecided' too: an unanswered question must not read as a green run.
  process.exitCode = verdict.level === 'source-id' ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
