import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Stage 3 of document 4 §2: the external identifiers the live layer hooks on.
 *
 * Document 4 §7 is the reason this exists at all — "l'aggancio è per
 * identificativo… nessuna corrispondenza di nomi a runtime". The name matching
 * happens here, once, offline, and what travels in the dataset is a number.
 * Without it the live layer is simply absent: no injury column, no auction
 * warning, everything else identical.
 *
 * **Where the file comes from.** The document lists thirteen inputs and none of
 * them is API-Football's, because §2 has the script read the disk and never the
 * network — a rule the CLAUDE.md relaxes for injuries at runtime and nowhere
 * else. So the roster is saved by hand, once a season, the same way the FBref
 * exports are:
 *
 *     curl -H 'x-apisports-key: …' \
 *       'https://v3.football.api-sports.io/players/squads?team=505' \
 *       > tools/dataset/input/api-football/inter.json
 *
 * One request per club, twenty-one including the one that lists the clubs, out
 * of a hundred a day. Any number of files, any of the two shapes below, in any
 * mixture: whatever you managed to save is what the stage uses.
 */

/** `/players/squads?team=…` — a club and its roster. One request per club. */
const squads = z.array(
  z.object({
    team: z.object({ name: z.string() }),
    players: z.array(z.object({ id: z.number().int(), name: z.string() })),
  }),
)

/** `/players?league=135&season=…` — paginated, twenty per page, but richer. */
const players = z.array(
  z.object({
    player: z.object({
      id: z.number().int(),
      name: z.string(),
      firstname: z.string().nullish(),
      lastname: z.string().nullish(),
      birth: z.object({ date: z.string().nullish() }).nullish(),
    }),
    statistics: z.array(z.object({ team: z.object({ name: z.string() }) })).min(1),
  }),
)

export interface ApiFootballPlayer {
  apiFootballId: number
  name: string
  /** As API-Football spells it. Mapped onto the listone's spelling by the caller. */
  team: string
  birthYear: number | null
}

export interface ApiFootballInput {
  players: ApiFootballPlayer[]
  /** Anything that went wrong, for the report. Never thrown. */
  problems: string[]
}

/**
 * The `response` array of either endpoint, with or without its envelope.
 *
 * Saved by hand means saved in whatever way was convenient: the whole JSON body,
 * or just the array out of it. Both are unambiguous to recognise, so both are
 * accepted rather than making the person remember which one this wanted.
 */
export function parseRoster(raw: unknown, label: string): ApiFootballPlayer[] {
  const body = raw !== null && typeof raw === 'object' && 'response' in raw ? (raw as { response: unknown }).response : raw

  const asSquads = squads.safeParse(body)
  if (asSquads.success) {
    return asSquads.data.flatMap((entry) =>
      entry.players.map((player) => ({
        apiFootballId: player.id,
        name: player.name,
        team: entry.team.name,
        birthYear: null,
      })),
    )
  }

  const asPlayers = players.safeParse(body)
  if (asPlayers.success) {
    return asPlayers.data.map((entry) => {
      const { firstname, lastname, name, id, birth } = entry.player
      // Sliced then tested as text: `Number('')` is 0, and a birth year of zero
      // would be a value rather than the absence it actually is.
      const raw = (birth?.date ?? '').slice(0, 4)
      const year = /^\d{4}$/.test(raw) ? Number(raw) : null
      return {
        apiFootballId: id,
        // `name` comes abbreviated — "L. Martínez" — and an initial is worth
        // nothing to a token match. The two halves spell it out when they are there.
        name: firstname && lastname ? `${firstname} ${lastname}` : name,
        team: entry.statistics[0].team.name,
        birthYear: year,
      }
    })
  }

  throw new Error(
    `${label}: non è né una risposta di /players/squads né una di /players.\n` +
      `  come /players/squads: ${asSquads.error.issues[0]?.path.join('.')} ${asSquads.error.issues[0]?.message}\n` +
      `  come /players:        ${asPlayers.error.issues[0]?.path.join('.')} ${asPlayers.error.issues[0]?.message}`,
  )
}

/** Reads whatever is in `input/api-football/`, and is content with what it finds. */
export function readApiFootball(dir: string): ApiFootballInput {
  const problems: string[] = []
  if (!existsSync(dir)) {
    return { players: [], problems: [`${dir}: la cartella non c'è, lo stadio identificativi non gira`] }
  }

  const byId = new Map<number, ApiFootballPlayer>()
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    if (!name.toLowerCase().endsWith('.json')) {
      problems.push(`${name}: non è un .json, file ignorato`)
      continue
    }
    try {
      const parsed = parseRoster(JSON.parse(readFileSync(join(dir, name), 'utf8')), name)
      // Clubs overlap between saves — a roster file and a page of /players can
      // both carry the same person. Keyed by id, so a second sighting is the same
      // player rather than a duplicate candidate that would read as ambiguous.
      for (const player of parsed) if (!byId.has(player.apiFootballId)) byId.set(player.apiFootballId, player)
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { players: [...byId.values()], problems }
}
