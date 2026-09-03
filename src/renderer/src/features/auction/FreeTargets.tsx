import { useEffect, useRef, useState } from 'react'
import Figure from '@/components/Figure'
import { MAX_RATING } from '@shared/domain'
import type { AuctionState } from '@shared/types'

type Free = AuctionState['targetsFree'][number]

/**
 * "Obiettivi ancora liberi", document 2 §4.8: "i tuoi target ancora non
 * assegnati, ordinati per fascia e rating. Quando qualcuno te ne compra uno
 * sparisce dall'elenco con un lampeggio rosso. Serve a sapere in tempo reale
 * quanto del tuo piano è ancora in piedi."
 *
 * The order arrives already applied — `auctionState` sorts by tier and then by
 * rating — so nothing here re-sorts it. The grouping by tier is this screen's
 * own: the list is sorted by a key that would otherwise be invisible, and four
 * teal stars above four teal stars, one worth twice the other, is a list that
 * looks unsorted.
 */
export default function FreeTargets({ targets }: { targets: readonly Free[] }): JSX.Element {
  const leaving = useLeaving(targets)

  if (targets.length === 0 && leaving.length === 0) {
    return (
      <section className="min-h-0 overflow-auto p-3">
        <h2 className="label pb-2 text-xs text-chalk-dim">Obiettivi ancora liberi</h2>
        <p className="text-sm text-chalk-dim">
          Nessun obiettivo ancora libero. Li prepari dalla scheda Obiettivi.
        </p>
      </section>
    )
  }

  const groups = new Map<number | null, Free[]>()
  for (const row of targets) {
    const bucket = groups.get(row.tier)
    if (bucket) bucket.push(row)
    else groups.set(row.tier, [row])
  }

  return (
    <section className="min-h-0 overflow-auto p-3">
      <h2 className="label pb-1 text-xs text-chalk-dim">Obiettivi ancora liberi</h2>

      {/* The ones somebody just bought, still on screen for their 400ms. */}
      {leaving.map((row) => (
        <Tile key={`lost-${row.playerId}`} row={row} lost />
      ))}

      {[...groups].map(([tier, rows]) => (
        <div key={tier ?? 'senza'}>
          <h3 className="label pt-1 text-xs text-chalk-dim">
            {tier === null ? 'senza fascia' : `fascia ${tier}`}
          </h3>
          {rows.map((row) => (
            <Tile key={row.playerId} row={row} />
          ))}
        </div>
      ))}
    </section>
  )
}

function Tile({ row, lost = false }: { row: Free; lost?: boolean }): JSX.Element {
  return (
    <p className={`flex items-baseline gap-2 py-0.5 text-sm ${lost ? 'flash-lost' : ''}`}>
      {/* `★` is a glossary key, and this is still not an `Abbr`: the entry
          explains the *column* of the players table, and §10 spends its whole
          first paragraph on the difference — an abbreviation explains itself
          where it is defined, never where it is used. Here the stars are the
          value, and the `aria-label` already says how many out of how many. */}
      <span className="shrink-0 text-xs text-target" aria-label={`${row.rating ?? 0} su ${MAX_RATING}`}>
        {'★'.repeat(row.rating ?? 0)}
        <span className="text-line">{'☆'.repeat(MAX_RATING - (row.rating ?? 0))}</span>
      </span>
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
      {/* Neither of these two is an abbreviation the glossary can hold — the
          role letters collide between Classic and Mantra, the club codes are
          data that changes with every promotion — and neither is a `RoleBadge`
          either: §10 gives the badge a shape, and a shape here would be the
          heaviest thing in a row that already carries five stars. Text. */}
      <span className="label shrink-0 text-xs text-chalk-dim">
        {row.roleClassic} {row.teamCode}
      </span>
      {/*
        "fino a", not "max".

        The `max` of the glossary is the maximum bid, and it is on this same
        screen a few centimetres away, over every column of the roster grid.
        This number is a different thing entirely: the ceiling *you* set for
        this objective. One drawn string cannot carry two meanings, and §10
        says which one gives way — "la sigla migliore è quella che non serve".
        Spelled out, it also says what it is, which `max` never did here.

        The words stay outside `Figure` so the amber falls on the number alone
        (§15), and they go away with it: "fino a —" would read as a ceiling
        that exists and is unknown, where the truth is that there is none. The
        dash carries no `kind` for the same reason: there is no money there to
        colour.

        `min-w-14` and not the `w-14` this was: the prefix is three characters
        longer than `max`, and a fixed 3.5rem stops being enough somewhere
        around a three-digit price. The floor keeps the column, the nowrap keeps
        the row one line tall, and the name beside it is `min-w-0 flex-1
        truncate` and gives up the difference. Not measured in the running app:
        worth a look with a three-digit ceiling in the 320px panel.
      */}
      <span className="min-w-14 shrink-0 whitespace-nowrap text-right text-xs">
        {row.maxPrice === null ? (
          <Figure value={null} />
        ) : (
          <>
            fino a <Figure value={row.maxPrice} kind="money" />
          </>
        )}
      </span>
    </p>
  )
}

/**
 * The rows that were in the list a moment ago and are not any more, held for the
 * length of the flash so the disappearance is something you can see.
 *
 * Without this the objective would simply not be there on the next render, which
 * is the one thing §4.8 says this panel must not do: the point of the panel is
 * knowing "in tempo reale quanto del tuo piano è ancora in piedi", and a plan
 * that shrinks silently teaches nothing.
 *
 * The timer, not `onAnimationEnd`: the animation does not run at all while the
 * window is occluded — the case CLAUDE.md records — and a row waiting for an
 * event that will never fire would stay in the list for good, which is exactly
 * the opposite of what it is for.
 */
function useLeaving(targets: readonly Free[]): Free[] {
  const [leaving, setLeaving] = useState<Free[]>([])
  const previous = useRef<readonly Free[]>(targets)
  const timers = useRef<Set<number>>(new Set())

  /**
   * Each batch owns its own timer, and the effect's cleanup does **not** cancel
   * it.
   *
   * That is the whole difference from the first version, which returned the
   * `clearTimeout` as its cleanup. `targets` is a new object on every write to
   * the `auction.state` cache — every purchase, every undo — so a second write
   * inside the 400ms killed the pending removal, and the re-run then computed
   * `gone` from an already-advanced `previous` and found nothing to reschedule.
   * The row stayed in `leaving` for good: `.flash-lost` ends with `forwards`, so
   * it settled at opacity 0 and held a blank line at the top of the panel.
   */
  useEffect(() => {
    const now = new Set(targets.map((t) => t.playerId))
    const gone = previous.current.filter((t) => !now.has(t.playerId))
    previous.current = targets
    if (gone.length === 0) return

    setLeaving((was) => [...was, ...gone])
    const ids = new Set(gone.map((t) => t.playerId))
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setLeaving((was) => was.filter((t) => !ids.has(t.playerId)))
    }, FLASH_MS)
    timers.current.add(timer)
  }, [targets])

  // The only cleanup that is correct here: leaving the screen, not changing.
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => window.clearTimeout(timer))
  }, [])

  return leaving
}

/** The 400ms of document 2 §2, and the duration of `.flash-lost` in base.css. */
const FLASH_MS = 400
