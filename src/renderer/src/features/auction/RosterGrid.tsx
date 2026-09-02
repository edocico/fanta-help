import { useState } from 'react'
import { useCountUp } from '@/lib/motion'
import { CLASSIC_ROLES, type ClassicRole } from '@shared/domain'
import { notices } from '@shared/errors'
import type { AuctionState, AuctionTeam } from '@shared/types'

/**
 * The rose grid of document 2 §4.8: "una riga per squadra, il colore della
 * squadra è la barra verticale a sinistra, pallini pieni per slot occupati e
 * vuoti per liberi, crediti residui e puntata massima in ambra".
 *
 * Two things in it are load-bearing rather than decorative:
 *
 * **The maximum bid of the team on turn is the signature element** of §2 — "la
 * cifra più grande sullo schermo dopo il nome del giocatore in asta. È il numero
 * che serve davvero mentre si rilancia e che nessun foglio Excel calcola da
 * solo." So it is set in type one size up, and only on that row: two of them
 * would be neither the largest nor the answer to a question anybody is asking.
 *
 * **The numbers are not recomputed here.** `maxBid` and `complete` arrive from
 * the main process, where invariant 5 lives. Recomputing them in the renderer is
 * the "due implementazioni di un'invariante" document 6 warns about: they would
 * agree until the evening they did not.
 */
export default function RosterGrid({
  state,
  flash,
}: {
  state: AuctionState
  /** The team whose row flashes, and a token that changes on every purchase. */
  flash: { teamId: number; token: number } | null
}): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())

  function toggle(id: number): void {
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <h2 className="label border-b border-line px-3 py-2 text-xs text-chalk-dim">Rose</h2>
      <ul className="min-h-0 flex-1 overflow-auto">
        {state.teams.map((team) => (
          <Row
            key={team.id}
            team={team}
            slots={state.slots}
            onTurn={team.id === state.currentTurnTeamId}
            expanded={open.has(team.id)}
            onToggle={() => toggle(team.id)}
            flashToken={flash?.teamId === team.id ? flash.token : null}
          />
        ))}
      </ul>
    </section>
  )
}

function Row({
  team,
  slots,
  onTurn,
  expanded,
  onToggle,
  flashToken,
}: {
  team: AuctionTeam
  slots: AuctionState['slots']
  onTurn: boolean
  expanded: boolean
  onToggle: () => void
  flashToken: number | null
}): JSX.Element {
  const credits = useCountUp(team.credits)
  const max = useCountUp(team.maxBid)

  return (
    <li className="relative border-b border-line">
      {/*
        The 400ms flash of §2, "nel colore della squadra". An overlay keyed by the
        purchase rather than a class on the row: a CSS animation only restarts
        when its element is mounted afresh, and remounting the row itself would
        collapse a roster somebody had just opened to check a price.

        A team with no colour chosen yet flashes chalk — the event is what the
        movement is reporting, and skipping it for those teams would make the
        feedback depend on a cosmetic choice nobody has made yet.
      */}
      {flashToken !== null && (
        <span
          key={flashToken}
          aria-hidden="true"
          className="flash-row pointer-events-none absolute inset-0"
          style={{ ['--flash' as string]: team.color ?? 'var(--chalk-dim)' }}
        />
      )}

      <button
        type="button"
        aria-expanded={expanded}
        className={`relative flex w-full items-center gap-2 px-3 py-1.5 text-left ${
          onTurn ? 'bg-pitch-700' : ''
        }`}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className="h-7 w-1 shrink-0 rounded-sm"
          style={{ backgroundColor: team.color ?? 'var(--line)' }}
        />

        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${team.isMine ? 'font-semibold' : ''}`}>
            {team.name}
            {team.complete && <span className="label ml-2 text-xs text-chalk-dim">rosa completa</span>}
          </span>
          <Dots slots={slots} filled={team.filled} />
        </span>

        <span className="figures shrink-0 text-right text-sm text-credit">
          {credits} <span className="label text-xs text-chalk-dim">cr</span>
        </span>
        <span
          className={`figures shrink-0 text-right text-credit ${onTurn ? 'text-2xl' : 'text-sm'}`}
          title="puntata massima"
        >
          <span className="label align-middle text-xs text-chalk-dim">max </span>
          {max}
        </span>
      </button>

      {expanded && <Roster team={team} />}
    </li>
  )
}

/**
 * "Pallini pieni per slot occupati, vuoti per liberi", per role.
 *
 * A role the league gave no slots to is left out entirely rather than drawn as
 * an empty group: §9 lets a league decide it has none, and "P" followed by
 * nothing reads as a rendering fault.
 *
 * More filled than there are slots is drawn, in `taken`. It cannot happen during
 * the auction — invariant 3 refuses the purchase — but revision lets those
 * violations through as warnings (invariant 11), and a ninth defender that
 * simply did not appear would hide the very anomaly §4.10 exists to fix.
 */
function Dots({
  slots,
  filled,
}: {
  slots: Readonly<Record<ClassicRole, number>>
  filled: Readonly<Record<ClassicRole, number>>
}): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-x-3 pt-0.5 text-xs leading-none">
      {CLASSIC_ROLES.filter((role) => slots[role] > 0 || filled[role] > 0).map((role) => (
        <span key={role} className="flex items-center gap-1">
          <span className="label text-chalk-dim">{role}</span>
          <span aria-label={`${filled[role]} su ${slots[role]}`}>
            {Array.from({ length: Math.max(slots[role], filled[role]) }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={i >= slots[role] ? 'text-taken' : i < filled[role] ? 'text-chalk' : 'text-line'}
              >
                {i < filled[role] ? '●' : '○'}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

/** "Cliccare una squadra espande la sua rosa completa sotto la riga, con i nomi e i prezzi pagati." */
function Roster({ team }: { team: AuctionTeam }): JSX.Element {
  if (team.roster.length === 0) {
    return <p className="px-3 pb-2 pl-6 text-xs text-chalk-dim">Nessun acquisto.</p>
  }

  return (
    <ul className="px-3 pb-2 pl-6">
      {[...team.roster]
        // By role and then by what was paid: the reading is "who does he have up
        // front", not "in what order did he buy". Sequence is the history's job.
        .sort((a, b) => CLASSIC_ROLES.indexOf(a.slotRole) - CLASSIC_ROLES.indexOf(b.slotRole) || b.price - a.price)
        .map((bought) => (
          <li key={bought.purchaseId} className="flex items-baseline gap-2 text-xs">
            <span className="label w-4 shrink-0 text-chalk-dim">{bought.slotRole}</span>
            <span className="min-w-0 flex-1 truncate">{bought.name}</span>
            {/* "Resta in rosa, marcato", §7. The purchase stands; the listing does not. */}
            {bought.delisted && (
              <span className="label shrink-0 text-taken" title={notices.DELISTED()}>
                fuori listone
              </span>
            )}
            <span className="label shrink-0 text-chalk-dim">{bought.teamCode}</span>
            <span className="figures w-8 shrink-0 text-right text-credit">{bought.price}</span>
          </li>
        ))}
    </ul>
  )
}
