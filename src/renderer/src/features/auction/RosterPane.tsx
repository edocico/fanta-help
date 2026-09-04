import { useLayoutEffect, useRef, useState } from 'react'
import type { AuctionState } from '@shared/types'
import RosterBoard from './RosterBoard'
import RosterGrid from './RosterGrid'

/**
 * Which of the two the auction screen shows — the board of document 7 §10, or
 * the row list it calls the fallback.
 *
 * §10: "sotto i 1100px la board diventa una lista di righe con i pallini degli
 * slot, come nella revisione 1. Non è la vista principale, è il ripiego." That
 * list is `RosterGrid`, unchanged, which is why T24 does not delete it.
 *
 * **Measured on the board's own area and not on the window**, and the two are
 * far apart enough that the choice decides the feature. During the auction the
 * assignment panel takes 320px flat and the rail 40 more, so a 1100px window
 * gives the board 740 — seven columns' worth. §10's number reads as a window
 * width, but the width that decides whether ten columns fit is this one, and no
 * width media query can see it. Hence the observer: the project's first, and
 * worth its weight only because the alternative is a threshold that is wrong by
 * 360px in the one mode the app exists for.
 *
 * **Measured, not derived.** Taken on the running app with a league of ten
 * teams at full rosters — 250 real cells — reading each surname's true width
 * with a `Range` over its contents, because `scrollWidth` on a block element
 * *is* `clientWidth` and would have answered the column width for every row.
 * What a cell spends on everything that is not the surname is 33,8px: the
 * price, the gap and the padding. The surnames themselves measure 44,3px at the
 * median, 65,4 at the 90th percentile and 99 at the widest — which is
 * `Milinkovic-Savic V.`, the longest of the 524.
 *
 * From which the curve, counted rather than guessed:
 *
 *   colonna 80px  → 44,4% dei cognomi troncati
 *   colonna 92px  → 18,8%
 *   colonna 98px  → 10,8%
 *   colonna 104px →  4,8%
 *   colonna 110px →  2,4%
 *
 * The threshold sits where truncation stops being incidental: a column of 98px,
 * where one name in ten is cut. Below that the fallback reads better, above it
 * the board does.
 *
 * **Per team and not a flat number**, because the width that decides truncation
 * is `(board − gutter) / teams` and nothing caps the teams — no `.max()` in the
 * zod schema, no constraint in the DDL. A flat 1000 would mount the fallback on
 * a four-team league whose columns are 221px and truncate nothing, and keep the
 * board on a fourteen-team one whose columns are 76px and truncate more than
 * four names in ten.
 *
 * At the window's own default and ten teams that comes to 996 against a board
 * area of 1080 — measured, 1440 less the 320 of the assignment panel and the 40
 * of the rail — so the board shows, its columns are 106,4px, and **three names
 * of 250 truncate**. The curve above says 2,4% at 110px, which is six: the two
 * are counted differently and both are right. The curve holds the cell's
 * overhead fixed at the value it has when the price is three digits, while the
 * name is a flex item that takes back what a shorter price leaves — most prices
 * are one digit.
 *
 * It depends on the cell's fixed 33,8px and on the listone's surnames. If the
 * cell gains a field, or a season arrives with longer names, this is recounted.
 */
const COLUMN_MIN_WIDTH = 98
const ROLE_GUTTER = 16

function boardFits(width: number, teams: number): boolean {
  return width >= teams * COLUMN_MIN_WIDTH + ROLE_GUTTER
}

export default function RosterPane({
  state,
  last,
  projected,
}: {
  state: AuctionState
  /**
   * The purchase to flash, in the two coordinates the two layouts need: the
   * board lights the cell, the fallback list lights the team's row. Not
   * `state.lastPurchase` — the auction view keeps its own, raised only on an
   * assignment that went through in this session, which is also what feeds the
   * toast. Reopening the screen must not replay a flash from yesterday.
   */
  last: { purchaseId: number; teamId: number } | null
  projected: boolean
}): JSX.Element {
  const pane = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = pane.current
    if (element === null) return
    // Read once before paint as well as observing: `ResizeObserver` delivers on
    // a later task, so the observer alone would show the board for one frame in
    // a window too narrow for it and then swap — a flicker on the screen this
    // app exists for.
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Unmeasured means the board: it is the view, and the fallback is the
  // exception. Being wrong for one frame in the direction of the main layout is
  // the cheaper of the two mistakes.
  const narrow = width !== null && !boardFits(width, state.teams.length)

  return (
    /*
      The same class chain the grid carried when it was the flex item itself. A
      plain `<div flex-1>` here reopens a fault this screen already had: the
      wrapper stretches to the row's height while the `<section>` inside keeps
      `height: auto`, its `overflow-auto` never has a height to overflow, and the
      whole screen scrolls instead — carrying off the top bar and the search
      field §4.8 says is always focused.
    */
    <div ref={pane} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {narrow ? (
        <RosterGrid
          state={state}
          flash={last === null ? null : { teamId: last.teamId, token: last.purchaseId }}
          projected={projected}
        />
      ) : (
        <RosterBoard state={state} flash={last?.purchaseId ?? null} projected={projected} />
      )}
    </div>
  )
}
