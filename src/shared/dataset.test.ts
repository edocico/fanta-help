import { describe, expect, it } from 'vitest'
import { dataset, datasetPlayer } from './dataset'

/**
 * The compatibility rule of the interchange format, which T7 found broken.
 *
 * `formatVersion` only says something if a field added to the format reads as
 * optional and only a genuinely breaking change bumps the number. T6 added
 * `birthYear` as required and left the number at 1, which made every dataset
 * published before it fail validation while still declaring itself version 1 —
 * and nothing noticed, because until T7 nothing read a dataset back.
 *
 * The test is here rather than in the pipeline because it is the *reader* that
 * has to be tolerant: the writer always emits the newest shape.
 */

const player = {
  sourceId: 2764,
  identityKey: 'fc-2764',
  name: 'Martinez L.',
  team: 'Inter',
  roleClassic: 'A',
  rolesMantra: ['A', 'Pc'],
  qtClassicInitial: 34,
  qtClassicCurrent: 34,
  qtMantraInitial: 34,
  qtMantraCurrent: 34,
  fvmClassic: 260,
  fvmMantra: 260,
  birthDate: null,
  birthYear: null,
  penaltyTaker: true,
  penaltyTakerSource: 'derived',
}

describe('datasetPlayer', () => {
  it('accepts the shape the pipeline writes today', () => {
    expect(datasetPlayer.parse(player).birthYear).toBeNull()
  })

  /** A file written before T6 existed. It has to stay readable. */
  it('reads a player written before birthYear existed', () => {
    // Deleting the key rather than destructuring it away: the assertion below has
    // to be about `older`, and an earlier version of this test checked the
    // destructured *value* instead — which is null either way, so it passed with
    // the key still present, i.e. it never tested the case it names.
    const older: Record<string, unknown> = { ...player }
    delete older.birthYear
    expect('birthYear' in older).toBe(false)
    expect(datasetPlayer.parse(older).birthYear).toBeNull()
  })

  /**
   * Tolerating an absent key must not turn into tolerating a wrong one: a year
   * that arrived as a string is a pipeline bug, and swallowing it would put a
   * silent nonsense into the column.
   */
  it('still refuses a birthYear that is not a whole number', () => {
    expect(() => datasetPlayer.parse({ ...player, birthYear: '1997' })).toThrow()
    expect(() => datasetPlayer.parse({ ...player, birthYear: 1997.5 })).toThrow()
  })
})

/**
 * Two shapes zod used to accept and SQLite then refused, one transaction deep.
 *
 * A constraint the schema cannot express is a constraint the database enforces
 * instead — and a `UNIQUE constraint failed` thrown inside the import crosses the
 * IPC boundary as UNKNOWN, so the message that says "rigeneralo con la pipeline"
 * never reaches the screen.
 */
describe('shapes the database would refuse', () => {
  const base = {
    format: 'fanta-help/dataset',
    formatVersion: 1,
    seasonId: '2026-27',
    version: 'v1',
    generatedAt: '2026-09-01',
    hasFbref: false,
    hasExternalIds: false,
    sources: [],
    serieATeams: [{ name: 'Inter', code: 'INT' }],
    players: [player],
    stats: [] as unknown[],
  }

  const stat = {
    identityKey: 'fc-2764',
    seasonId: '2025-26',
    team: 'Inter',
    roleClassic: 'A',
    matchesRated: 30,
    avgVote: 7,
    fantaAvg: 8.25,
    goals: 20,
    goalsConceded: 0,
    assists: 5,
    penaltiesTaken: 4,
    penaltiesScored: 3,
    penaltiesMissed: 1,
    penaltiesSaved: 0,
    yellowCards: 3,
    redCards: 0,
    ownGoals: 0,
    matchesPlayed: null,
    starts: null,
    minutes: null,
    cleanSheets: null,
  }

  /** `player_mantra_role` is PRIMARY KEY (player_id, role_code). */
  it('refuses a repeated Mantra role', () => {
    expect(() => datasetPlayer.parse({ ...player, rolesMantra: ['Dc', 'Dc'] })).toThrow()
    expect(datasetPlayer.parse({ ...player, rolesMantra: ['Dc', 'B'] }).rolesMantra).toHaveLength(2)
  })

  /** `player_season_stat` is UNIQUE (identity_key, season_id). */
  it('refuses two statistic rows for one player in one season', () => {
    expect(() => dataset.parse({ ...base, stats: [stat, stat] })).toThrow()
  })

  it('still accepts the same player across different seasons', () => {
    const parsed = dataset.parse({
      ...base,
      stats: [stat, { ...stat, seasonId: '2024-25' }],
    })
    expect(parsed.stats).toHaveLength(2)
  })
})
