import { useState } from 'react'
import Abbr from '@/components/Abbr'
import Figure from '@/components/Figure'
import Glyph from '@/components/Glyph'
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
/**
 * The two sizes the grid comes in, side by side so `tsc` counts them.
 *
 * `normal` is today's classes character for character: the unprojected screen
 * must not move by a pixel, and a copy sitting next to its variant is the only
 * form in which that stays checkable. `projected` reads its figures from the
 * custom properties `base.css` steps by window height — the sizes are declared
 * there and *named* here, so nothing overrides the component invisibly.
 *
 * Class names are written out whole. `text-${n}xl` interpolated is not emitted
 * by Tailwind at all and disappears in silence.
 *
 * The two `figureRole*` fields are the one exception to "character for
 * character", and a deliberate one: T23 gives the figures the family §4 asks
 * for, which in `normal` they did not have. No size moves, so nothing reflows.
 */
type Band = {
  team: string
  /** Labels, and the rows of an expanded roster. */
  small: string
  /** Font size and the gap between role groups, which has to grow with it. */
  dots: string
  credits: string
  max: string
  maxOnTurn: string
  rowY: string
  bar: string
  rosterRole: string
  rosterPrice: string
  /**
   * Which of §4's three figure roles the numbers of this band wear. `Figure`
   * derives the role from its `size`, and neither band gives it one: `normal`
   * inherits the size of the row it sits in, `projected` reads a custom
   * property that a media query steps by window height. So the role is named
   * here, next to the size that decides it.
   */
  figureRole: 'column' | 'projection'
  /**
   * And the prices inside an expanded roster, which are the one place here that
   * cannot wear the projection role at any step: `--proj-small` is 13, 15 and
   * 17px on the three rungs, and §15 forbids Archivo under 20 at all of them.
   * Plex, exactly as §11 settles the same question for the board — "i prezzi di
   * cella restano Plex: al gradino basso misurano 13px".
   */
  figureRoleSmall: 'column'
  /**
   * `small` è **l'unica** taglia di queste etichette, e non va affiancata da un
   * `text-micro`: sarebbero due utility di `font-size` sullo stesso elemento,
   * stessa specificità e stesso `@layer utilities`, e a decidere è l'ordine in
   * cui Tailwind le emette nel CSS costruito, non l'ordine nel `className`.
   * Misurato sul file emesso, `.text-micro` sta a 27297 e `.text-sm` a 27420:
   * vinceva `text-sm`, e il `text-micro` scritto qui era inerte — undici
   * dichiarati, dodici sullo schermo. È la trappola dei due segnali sulla stessa
   * proprietà applicata alla taglia, e qui senza `cn()` a fare da arbitro perché
   * la stringa è un template literal.
   */
  /**
   * And the maximum bid of the team on turn, which is the one figure of this
   * grid that carries a row on its own. In `normal` it renders at 24px — over
   * §4's 20px boundary — so it is a *large* figure, Archivo 600 at width 112,
   * and not a column one: sending it to Plex would shrink the signature element
   * of document 2 §2 into the same type as the labels beside it.
   */
  figureRoleOnTurn: 'large' | 'projection'
}

const SIZES: Record<'normal' | 'projected', Band> = {
  normal: {
    team: 'text-base',
    small: 'text-sm',
    dots: 'text-sm gap-x-3',
    credits: 'text-base',
    max: 'text-base',
    maxOnTurn: 'text-2xl',
    rowY: 'py-1.5',
    bar: 'h-7',
    rosterRole: 'w-4',
    rosterPrice: 'w-8',
    figureRole: 'column',
    figureRoleSmall: 'column',
    figureRoleOnTurn: 'large',
  },
  projected: {
    team: 'text-[length:var(--proj-team)] leading-tight',
    small: 'text-[length:var(--proj-small)]',
    // `1em` of the dots' own size reproduces today's 12px at 12px and grows with
    // them, which `gap-x-3` frozen at 12px would not.
    dots: 'text-[length:var(--proj-dots)] gap-x-[1em]',
    credits: 'text-[length:var(--proj-credits)] leading-tight',
    max: 'text-[length:var(--proj-credits)] leading-tight',
    maxOnTurn: 'text-[length:var(--proj-max)] leading-none',
    rowY: 'py-[var(--proj-row-y)]',
    bar: 'h-[var(--proj-bar-h)]',
    // `ch` and not a fixed width: the columns of an expanded roster have to keep
    // lining up when the figures in them are three times taller.
    rosterRole: 'w-[2ch]',
    rosterPrice: 'w-[4ch]',
    // Every figure of the projection wears the projection role, on turn or not:
    // its sizes come from `--proj-*` and not from §4's four tokens, so `Figure`
    // has nothing to derive the family from.
    //
    // Not a pure rename: `.figures` was Archivo 600 at width 125, and §4's
    // projection role is 700 at 125 with leading 1. The family and the width
    // are the ones the projection already had; the weight moves and the leading
    // arrives. Neither reflows — every wrapper here sets a taller strut of its
    // own (`leading-tight`, and `leading-none` on the on-turn row, where the
    // two are equal).
    //
    // The 20px floor §15 gives Archivo, which this comment used to record as
    // an open debt, is paid two ways in T25. `--proj-small` is under it at every
    // rung, so the prices it dresses take `figureRoleSmall` and stay Plex — the
    // answer §11 already gives the board. `--proj-credits` was under it at the
    // base rung only, and that rung moved from 18px to 20.
    //
    // The base rung is *reachable*, contrary to what this comment first claimed:
    // `main/index.ts` has `minHeight: 700`, so a viewport of ~672 sits below the
    // 760 that starts the second rung. Its height budget therefore still has to
    // hold, and T25 moved both sides of it — see the note beside the ladder in
    // `base.css`.
    figureRole: 'projection',
    figureRoleSmall: 'column',
    figureRoleOnTurn: 'projection',
  },
}

export default function RosterGrid({
  state,
  flash,
  projected,
}: {
  state: AuctionState
  /** The team whose row flashes, and a token that changes on every purchase. */
  flash: { teamId: number; token: number } | null
  /** Document 2 §4.9: "ingrandisce la griglia rose". */
  projected: boolean
}): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const band = SIZES[projected ? 'projected' : 'normal']

  function toggle(id: number): void {
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${projected ? 'projection-scale' : ''}`}
      /*
        The title goes in projection, and its 33px are what pays for the banner
        above: at 900×620 — the window before T24 widened it — the projected grid shows the same eleven rows as the
        normal one, which is the whole point of the first step of the scale. A
        section heading on a screen that has one section is also the first thing
        to cut for a reader three metres away — but the name still has to reach
        anybody navigating by landmarks, so it moves onto the section itself.
      */
      aria-label={projected ? 'Rose' : undefined}
    >
      {!projected && (
        <h2 className="label border-b border-line px-3 py-2 text-micro text-fg-muted">Rose</h2>
      )}
      <ul className="min-h-0 flex-1 overflow-auto">
        {state.teams.map((team) => (
          <Row
            key={team.id}
            team={team}
            slots={state.slots}
            band={band}
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
  band,
  onTurn,
  expanded,
  onToggle,
  flashToken,
}: {
  team: AuctionTeam
  slots: AuctionState['slots']
  band: Band
  onTurn: boolean
  expanded: boolean
  onToggle: () => void
  flashToken: number | null
}): JSX.Element {
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
          style={{ ['--flash' as string]: team.color ?? 'var(--text-muted)' }}
        />
      )}

      <button
        type="button"
        aria-expanded={expanded}
        className={`relative flex w-full items-center gap-2 px-3 ${band.rowY} text-left ${
          onTurn ? 'bg-surface-raised' : ''
        }`}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={`${band.bar} w-1 shrink-0 rounded-sm`}
          style={{ backgroundColor: team.color ?? 'var(--line)' }}
        />

        <span className="min-w-0 flex-1">
          <span className={`block truncate ${band.team} ${team.isMine ? 'font-semibold' : ''}`}>
            {team.name}
            {team.complete && (
              <span className={`label ml-2 ${band.small} text-fg-muted`}>rosa completa</span>
            )}
          </span>
          <Dots slots={slots} filled={team.filled} band={band} />
        </span>

        {/*
          `cr` and `max` are two of the seventeen, so they come from the
          glossary and carry their expansion with them. The render prop and not
          the plain form: both sit inside the row's own `<button>`, and `Abbr`'s
          default trigger is a `tabIndex={0}` span — a tab stop inside a tab
          stop, on one word. Nothing is lost by it. §10 turns the popover off in
          the auction, which is the only place this grid is drawn, so what the
          abbreviation is really carrying here is the hidden expansion, and that
          stays either way.

          The `title="puntata massima"` that used to sit on the second one is
          gone: it was the one place in the app where a native `title` glossed an
          abbreviation, which §10 and §15 both forbid. The popover says it now,
          wherever the popover is lit.

          The two `useCountUp` calls went with it: `Figure` counts a `money`
          figure itself, which is the one animation §7 gives a number.
        */}
        <span className={`shrink-0 text-right ${band.credits}`}>
          <Figure value={team.credits} kind="money" role={band.figureRole} />{' '}
          <Abbr name="cr">
            {(label, trigger) => (
              <span className={`${trigger} label ${band.small} text-fg-muted`}>{label}</span>
            )}
          </Abbr>
        </span>
        <span className={`shrink-0 text-right ${onTurn ? band.maxOnTurn : band.max}`}>
          <Abbr name="max">
            {(label, trigger) => (
              <span className={`${trigger} label align-middle ${band.small} text-fg-muted`}>
                {label}
              </span>
            )}
          </Abbr>{' '}
          <Figure
            value={team.maxBid}
            kind="money"
            role={onTurn ? band.figureRoleOnTurn : band.figureRole}
          />
        </span>
      </button>

      {expanded && <Roster team={team} band={band} />}
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
  band,
}: {
  slots: Readonly<Record<ClassicRole, number>>
  filled: Readonly<Record<ClassicRole, number>>
  band: Band
}): JSX.Element {
  return (
    <span className={`flex flex-wrap items-center pt-0.5 leading-none ${band.dots}`}>
      {CLASSIC_ROLES.filter((role) => slots[role] > 0 || filled[role] > 0).map((role) => (
        <span key={role} className="flex items-center gap-1">
          <span className="label text-micro text-fg-muted">{role}</span>
          <span aria-label={`${filled[role]} su ${slots[role]}`}>
            {Array.from({ length: Math.max(slots[role], filled[role]) }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={i >= slots[role] ? 'text-fg-muted' : i < filled[role] ? 'text-fg' : 'text-line'}
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
function Roster({ team, band }: { team: AuctionTeam; band: Band }): JSX.Element {
  if (team.roster.length === 0) {
    return <p className={`px-3 pb-2 pl-6 ${band.small} text-fg-muted`}>Nessun acquisto.</p>
  }

  return (
    <ul className="px-3 pb-2 pl-6">
      {[...team.roster]
        // By role and then by what was paid: the reading is "who does he have up
        // front", not "in what order did he buy". Sequence is the history's job.
        .sort((a, b) => CLASSIC_ROLES.indexOf(a.slotRole) - CLASSIC_ROLES.indexOf(b.slotRole) || b.price - a.price)
        .map((bought) => (
          <li key={bought.purchaseId} className={`flex items-baseline gap-2 ${band.small}`}>
            {/* Text and not a `RoleBadge`, for the reason `FreeTargets` gives:
                §10 makes the badge a *shape*, and an 18px square is both the
                heaviest thing in a 12px row and a fixed size inside a column
                (`rosterRole`) that the projection scales by media query.
                `review/Row.tsx` draws the same `slotRole` as a badge because
                its row is 40px and stands still — the primitive is right
                there, the density is what differs. */}
            <span className={`label text-micro ${band.rosterRole} shrink-0 text-fg-muted`}>
              {bought.slotRole}
            </span>
            <span className="min-w-0 flex-1 truncate">{bought.name}</span>
            {/* "Resta in rosa, marcato", §7. The purchase stands; the listing does not. */}
            {bought.delisted && (
              <Glyph
                mark="fuori listone"
                says={notices.DELISTED()}
                className="label text-micro shrink-0 text-unavailable"
              />
            )}
            {/* The club code is data — all twenty are derived from the club
                name and change with every promotion — so it is not in the
                glossary and does not get a popover. The column that would
                explain it is `squa`, and this list has no headings. */}
            <span className="label text-micro shrink-0 text-fg-muted">{bought.teamCode}</span>
            {/* Money, so amber and tabular, and `Figure` brings both. The
                count-up it brings with them never runs: a price paid does not
                change, and the hook starts on the value it is given. */}
            <Figure
              value={bought.price}
              kind="money"
              role={band.figureRoleSmall}
              className={`${band.rosterPrice} shrink-0 text-right`}
            />
          </li>
        ))}
    </ul>
  )
}
