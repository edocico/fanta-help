import { describe, expect, it } from 'vitest'
import { contracts } from '@shared/contracts'
import { raise, toResult } from '@shared/errors'
import { handlers } from './handlers'

/**
 * The test T4 exists to produce. It imports handlers.ts and never register.ts,
 * which is why handlers.ts must not reach `electron`: Vitest runs on plain Node,
 * and better-sqlite3 is compiled for Electron's ABI.
 *
 * If this file ever needs a mock or a setup step, something imported electron.
 */

const declared = Object.keys(contracts).sort()
const registered = Object.keys(handlers).sort()

describe('IPC channel coverage', () => {
  it('has a handler for every contract', () => {
    expect(declared.filter((c) => !registered.includes(c))).toEqual([])
  })

  it('has a contract for every handler', () => {
    expect(registered.filter((c) => !declared.includes(c))).toEqual([])
  })

  it('declares at least one channel', () => {
    expect(declared.length).toBeGreaterThan(0)
  })
})

/**
 * Same file because it guards the same thing: that what a service refuses is what
 * the renderer reads. register.ts funnels every throw through toResult, so if
 * toResult stopped recognising a DomainError, all eight domain codes would go
 * mute as UNKNOWN — and nothing would fail except the copy on screen.
 */
describe('domain refusals survive the boundary', () => {
  it('keeps the code and the message of a raised refusal', () => {
    const result = toResult(
      (() => {
        try {
          raise('EXCEEDS_MAX_BID', { team: 'Real Fanta', max: 40, n: 4 })
        } catch (e) {
          return e
        }
      })(),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EXCEEDS_MAX_BID')
    expect(result.error.message).toBe(
      'Real Fanta può arrivare a 40: deve tenere 4 crediti per gli slot rimasti',
    )
  })

  it('still reports an unexpected throw as UNKNOWN', () => {
    const result = toResult(new Error('disco pieno'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNKNOWN')
    expect(result.error.details).toBe('disco pieno')
  })
})

/**
 * The outer half of rule 2 for the one input that cannot be taken back.
 *
 * `season.id` is a primary key that `league` and `player` reference and that
 * nothing in the app deletes: a typo confirmed once in the onboarding screen
 * would leave a season called "pippo" in the database for good. The service
 * checks it too; this is the check that happens before the service is called.
 */
describe('listone.import input', () => {
  const input = contracts['listone.import'].input

  it('accepts a season', () => {
    expect(input.safeParse({ filePath: '/x.xlsx', seasonId: '2026-27' }).success).toBe(true)
  })

  it.each(['pippo', '2026', '26-27', '2026-2027', ''])('refuses %o', (seasonId) => {
    expect(input.safeParse({ filePath: '/x.xlsx', seasonId }).success).toBe(false)
  })
})
