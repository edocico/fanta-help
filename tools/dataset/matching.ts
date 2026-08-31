import { normalizeName } from '@shared/domain'

/**
 * The reconciliation between sources of document 4 §5, shared by both optional
 * stages because both have exactly this problem.
 *
 * The argument in the document is worth restating, because it is what makes a
 * name match defensible at all. Serie A has **two Thuram**, Marcus and Khéphren.
 * Matching on the surname alone fuses them into one person with absurd numbers,
 * and nothing looks wrong until somebody reads that row. They play for different
 * clubs, so surname *plus club* separates them by itself — and the club cuts the
 * candidate pool from six hundred to about thirty, which is what makes the rest
 * of the guesswork tolerable.
 *
 * Everything here refuses rather than guesses. A player this cannot place gets
 * four empty columns and is named in the report; a player it places wrongly gets
 * somebody else's season, and no one finds out.
 */

/**
 * Tokens that are the legal form of a club rather than its name. Dropped so that
 * `SSC Napoli`, `AC Milan` and `US Lecce` reduce to what the listone calls them.
 *
 * Dropping them is a courtesy, not the mechanism: the match is an intersection,
 * so a surviving noise token only matters if a listone club is *named* after it,
 * and none is.
 */
const CLUB_NOISE = new Set(['fc', 'ac', 'as', 'ss', 'ssc', 'us', 'usd', 'ssd', 'acf', 'asd', 'calcio', 'spa', 'srl'])

function clubTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((token) => token.length > 1 && !CLUB_NOISE.has(token) && !/^\d+$/.test(token))
}

export interface ClubMapping {
  /** Foreign club name → the listone's spelling of the same club. */
  byForeign: Map<string, string>
  /** Foreign clubs no listone club shares a word with. */
  unmapped: string[]
  /** Foreign clubs that match more than one listone club. */
  ambiguous: string[]
}

/**
 * Maps a source's club names onto the listone's, by shared word.
 *
 * Derived from the listone every run rather than kept as a table, and that is
 * deliberate: three clubs go down and three come up every summer, so a hand
 * written table is wrong once a year, in July, months before anybody runs the
 * pipeline again. `Hellas Verona` and `Verona` share a word; `AC Milan` and
 * `Milan` share a word. Two Serie A clubs sharing one has not happened, and if
 * it ever does this says so instead of picking.
 */
export function mapClubs(listone: string[], foreign: string[]): ClubMapping {
  const listoneTokens = listone.map((name) => ({ name, tokens: new Set(clubTokens(name)) }))
  const byForeign = new Map<string, string>()
  const unmapped: string[] = []
  const ambiguous: string[] = []

  for (const name of [...new Set(foreign)]) {
    const tokens = clubTokens(name)
    const hits = listoneTokens.filter((club) => tokens.some((token) => club.tokens.has(token)))
    if (hits.length === 1) byForeign.set(name, hits[0].name)
    else if (hits.length === 0) unmapped.push(name)
    else ambiguous.push(`${name} → ${hits.map((h) => h.name).join(', ')}`)
  }

  return { byForeign, unmapped, ambiguous }
}

/**
 * Words of a person's name worth scoring.
 *
 * Single letters are left out, and the reason is a false match rather than a
 * missed one: the listone writes `Thuram M.` where FBref writes `Marcus Thuram`,
 * so initials are common — and `Rossi M.` against a team-mate spelled
 * `M. Bianchi` would share the word `m` and match two unrelated people.
 */
export function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((token) => token.length > 1)
}

/**
 * The letters a name commits to: the first of every word, an initial included.
 *
 * Initials do not score, but they *do* separate. `Martinez L.` in a club that
 * fields both `L. Martínez` and `J. Martínez` is decided by that `l`, and
 * throwing it away would leave the pair ambiguous while the file was telling us
 * which one it meant.
 */
/**
 * The abbreviations a name spells out, read **before** normalisation.
 *
 * This is the whole reason the raw name is passed around instead of a normalised
 * one. `normalizeName` strips the dot, so `Pellegrini Lu.` becomes `pellegrini
 * lu` and, reduced to first letters, its `l` is indistinguishable from Lorenzo's
 * — which is exactly the pair the listone writes two letters to separate. Kept as
 * `lu` and compared as a prefix, it separates them again.
 */
function abbreviations(name: string): string[] {
  return [...name.matchAll(/(\p{Letter}{1,3})\./gu)].map((match) => normalizeName(match[1])).filter(Boolean)
}

/** Every word of a name, one-letter ones included: the veto has to see them. */
function allTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter(Boolean)
}

function initials(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter(Boolean)
      .map((token) => token[0]),
  )
}

export type Outcome<T> =
  | { kind: 'matched'; to: T }
  | { kind: 'none' }
  | { kind: 'ambiguous'; between: string[] }

export interface Person {
  name: string
  /** The listone's spelling of the club, already mapped. */
  team: string
  birthYear?: number | null
}

/**
 * One player of the listone against the candidates of his club.
 *
 * Scored by how many words the two names share, and the best score has to be
 * held by exactly one candidate. A tie is only broken by a birth year, and only
 * when one candidate carries it: `overrides.json` has a `birthDates` section for
 * precisely the handful of people this ever comes down to.
 */
export function matchWithinClub<T extends Person>(target: Person, candidates: T[], year?: number | null): Outcome<T> {
  const wanted = nameTokens(target.name)
  if (wanted.length === 0) return { kind: 'none' }
  const shortened = abbreviations(target.name)

  /**
   * What the target says about a candidate that is *not* his surname, used as a
   * veto and not as a tie-break.
   *
   * The distinction is the whole of it. A tie-break only runs when two candidates
   * are level, and one candidate is the ordinary case — FBref lists whoever
   * played, the listone also carries whoever did not. So a Roma with `Pellegrini
   * Lo.` and `Pellegrini Lu.` on the listone and only Lorenzo in the export used
   * to hand Lorenzo's two thousand minutes to Luca, unopposed, and report it as a
   * clean match. An initial that contradicts, or a birth year that contradicts,
   * has to be able to say no on its own.
   */
  const survives = (candidate: T): boolean => {
    if (year != null && candidate.birthYear != null && candidate.birthYear !== year) return false
    const spare = allTokens(candidate.name).filter((token) => !wanted.includes(token))
    return shortened.every((abbrev) => spare.some((token) => token.startsWith(abbrev)))
  }

  const scored = candidates
    .filter((candidate) => candidate.team === target.team)
    .map((candidate) => {
      const tokens = new Set(nameTokens(candidate.name))
      return { candidate, score: wanted.filter((token) => tokens.has(token)).length }
    })
    .filter((entry) => entry.score > 0 && survives(entry.candidate))

  if (scored.length === 0) return { kind: 'none' }

  const best = Math.max(...scored.map((entry) => entry.score))
  let winners = scored.filter((entry) => entry.score === best).map((entry) => entry.candidate)

  if (winners.length > 1) {
    const wantedInitials = initials(target.name)
    const spelled = winners.filter((winner) => {
      const has = initials(winner.name)
      return [...wantedInitials].every((letter) => has.has(letter))
    })
    if (spelled.length === 1) winners = spelled
  }

  if (winners.length > 1 && year != null) {
    const sameYear = winners.filter((winner) => winner.birthYear === year)
    if (sameYear.length === 1) winners = sameYear
  }

  if (winners.length === 1) return { kind: 'matched', to: winners[0] }
  return { kind: 'ambiguous', between: winners.map((winner) => winner.name) }
}
