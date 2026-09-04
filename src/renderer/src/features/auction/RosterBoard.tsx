import Abbr from '@/components/Abbr'
import Figure from '@/components/Figure'
import { boardGrid, ROLE_LABELS } from '@shared/domain'
import { notices } from '@shared/errors'
import type { AuctionState, AuctionTeam } from '@shared/types'

/**
 * The board of document 7 §10 — "squadre in colonna, slot in riga, raggruppati
 * per ruolo" — and, at a bigger step of its own scale, the projection of §11.
 *
 * It replaces the row panel of document 2 §4.8, which survives beside it as the
 * narrow fallback §10 asks for; `RosterGrid` is that fallback, unchanged.
 *
 * **A real `<table>`, and not a grid of divs.** The question this screen answers
 * is "who has what", which is a row-and-column question: a table gives a screen
 * reader the association between a price, the slot it sits in and the team that
 * paid it, and gives it for free. The role letter is a `rowgroup` heading
 * spanning its band, exactly as the sketch in §10 draws it — one letter to the
 * left of all the columns, not one per column.
 *
 * **Which is why "reparto completo" is not on the letter.** §10 says "la lettera
 * del ruolo passa a `--confirmed`", and that rule cannot be applied as written:
 * the letter is shared by every column while a full department belongs to one
 * team. Colouring it would say "everybody has finished their defenders" — a
 * different sentence, and usually a false one. So the signal moves inside the
 * column, where the fact lives: the band's cells carry an inset rule in
 * `--confirmed`. Nothing is lost, because the board already says it twice over —
 * a full department is a band with no dashes in it.
 *
 * **The flash is on the cell**, which is what §7 asks for by name ("cella della
 * board che lampeggia nel colore squadra") and what the row panel could only
 * approximate. Keyed by `purchaseId` so the animation restarts per purchase,
 * and drawn as an overlay rather than a class on the cell for the reason the
 * row panel gave: a CSS animation only restarts on a freshly mounted element.
 *
 * **Nothing here is recomputed.** `credits`, `maxBid` and `complete` come from
 * the main process, where invariant 5 lives. The board arranges them.
 */
export default function RosterBoard({
  state,
  flash,
  projected,
}: {
  state: AuctionState
  /** The purchase whose cell flashes — `lastPurchase`, or null before the first. */
  flash: number | null
  /** Document 7 §11: the same board, one step up its own scale. */
  projected: boolean
}): JSX.Element {
  const { groups, columns } = boardGrid(
    state.slots,
    state.teams.map((team) => team.roster),
  )

  return (
    <section
      className={`board flex min-h-0 min-w-0 flex-1 flex-col overflow-auto ${
        projected ? 'projection-scale bg-pitch-950' : ''
      }`}
      /* Same reasoning as the row panel: on a screen with one section the
         heading is the first thing to cut for a reader three metres away, but
         the name still has to reach anyone navigating by landmarks. */
      aria-label={projected ? 'Rose' : undefined}
    >
      {!projected && (
        <h2 className="label shrink-0 border-b border-line px-3 py-2 text-micro text-chalk-dim">Rose</h2>
      )}

      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[var(--board-gutter)]" />
          {state.teams.map((team) => (
            <col key={team.id} />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th className={`sticky top-0 z-10 ${projected ? 'bg-pitch-950' : 'bg-pitch-900'}`} />
            {state.teams.map((team) => (
              <ColumnHead
                key={team.id}
                team={team}
                onTurn={team.id === state.currentTurnTeamId}
                projected={projected}
              />
            ))}
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.role}>
            {Array.from({ length: group.rows }, (_, row) => (
              <tr key={row}>
                {row === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={group.rows}
                    className="label text-micro border-t border-line align-top"
                    style={{ color: 'var(--board-muted)' }}
                  >
                    {/* `ROLE_LABELS` and not `ROLE_LABELS_ONE`, and the two are
                        one keystroke apart with nothing failing in between: the
                        role badge of T23 shipped with the wrong one and told a
                        screen reader "portieri" for a single player's role.
                        Here the plural is the right one — this heading covers a
                        whole band of slots, so it names the department. */}
                    <span className="sr-only">{ROLE_LABELS[group.role]}</span>
                    <span aria-hidden="true">{group.role}</span>
                  </th>
                )}
                {state.teams.map((team, column) => (
                  <Cell
                    key={team.id}
                    bought={columns[column].cells[group.role][row]}
                    first={row === 0}
                    /* Past the league's own slots: invariant 11 let this
                       through in revision, and it has to be visible. */
                    beyond={row >= group.rows - group.beyond}
                    complete={columns[column].complete[group.role]}
                    onTurn={team.id === state.currentTurnTeamId}
                    mine={team.isMine}
                    color={team.color}
                    flashing={
                      flash !== null && columns[column].cells[group.role][row]?.purchaseId === flash
                    }
                  />
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  )
}

/**
 * "Barra del colore squadra a piena larghezza, nome, poi crediti residui e
 * puntata massima in ambra."
 *
 * **Without the nouns**, and the document decides that against itself: the prose
 * of §10 asks for `218 crediti · max 205` while its own sketch ten lines below
 * prints `218 · max 205`. The house rule breaks the tie — a noun beside a
 * counting figure disagrees with it while `Figure` animates, and a department
 * going from nought to one shows "0 credito" for half of the 200ms. The colour
 * carries the meaning instead: amber is money and nothing else uses it.
 */
function ColumnHead({
  team,
  onTurn,
  projected,
}: {
  team: AuctionTeam
  onTurn: boolean
  projected: boolean
}): JSX.Element {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 border-b border-line px-1 pb-1 text-left align-bottom ${
        onTurn ? 'bg-pitch-700' : projected ? 'bg-pitch-950' : 'bg-pitch-900'
      } ${team.isMine ? 'border-l border-l-line-strong' : ''}`}
    >
      <span
        aria-hidden="true"
        className="mb-1 block w-full rounded-sm"
        style={{
          height: 'var(--board-bar)',
          backgroundColor: team.color ?? 'var(--color-line)',
        }}
      />
      <span
        className={`block truncate ${team.isMine ? 'font-semibold text-chalk' : 'font-normal text-chalk'}`}
        style={{ fontSize: 'var(--board-name)' }}
        title={team.name}
      >
        {team.name}
      </span>
      {/*
        The two figures of the column head, and only the team on turn gets its
        maximum bid one step up: document 2 §2 makes it "la cifra più grande
        sullo schermo dopo il nome del giocatore in asta", and two of them would
        be neither the largest nor the answer to a question anybody is asking.

        **On two lines, and the sketch in §10 puts them on one.** The sketch's
        line is right exactly while the column is wide enough for it, and the
        column is not something this file can know: nothing caps the number of
        teams in a league — no `.max()` in the zod schema, no constraint in the
        DDL — so the column is `board width / teams`, and every width-dependent
        layout here has a league size that breaks it. Measured at ten teams:
        `338 · max 323` asks for 135,6px of a 137,6px projected column and
        `122 · max 120`, which is the team on turn and a quarter larger, asks for
        147. It was clipping against the column beside it.

        Two lines carry one figure each — about 3,3 times the type size — and fit
        any column the app can produce. The cost is height, and height is the
        scarce one: it is paid once here, in `base.css`, where the cell sizes are
        measured against it.

        The fault hid behind the fixture the first time. A league seeded with
        full rosters puts every team at `0 · max 0`, where one line fits and the
        check comes back clean on all ten columns.
      */}
      <span className="block" style={{ fontSize: 'var(--board-head)', color: 'var(--board-muted)' }}>
        {/*
          The figure has no word beside it on screen — amber is money and §10's
          own sketch prints the bare number — but it needs one for anyone not
          looking at the screen, or the heading reads "Real Fanta 218 max 205"
          and the 218 is named by nothing. §12: "mai il colore da solo".

          Before the figure and not after: after, it would be a noun beside a
          counting number again, which is the whole reason the visible one went.
        */}
        <span className="sr-only">crediti residui </span>
        <Figure value={team.credits} kind="money" role={projected ? 'projection' : 'large'} />
      </span>
      <span className="flex items-baseline gap-1" style={{ color: 'var(--board-muted)' }}>
        {/*
          `Abbr` and not a bare word: `max` is one of the eighteen glossary
          entries, and §10 puts the column heading among the places where an
          abbreviation *is* explained. The popover stays dark here — `useDense()`
          is true on the auction route, which is the only place this is drawn —
          so what it actually carries is the hidden expansion, and that is the
          half a screen reader needs. It costs no pixels.
        */}
        <Abbr name="max">
          {(label, trigger) => (
            <span className={`${trigger} label text-micro shrink-0`} style={{ fontSize: 'var(--board-price)' }}>
              {label}
            </span>
          )}
        </Abbr>
        <MaxBid team={team} onTurn={onTurn} projected={projected} />
      </span>
    </th>
  )
}

/**
 * The maximum bid, one step larger for the team on turn only.
 *
 * Document 2 §2 calls it "la cifra più grande sullo schermo dopo il nome del
 * giocatore in asta. È il numero che serve davvero mentre si rilancia e che
 * nessun foglio Excel calcola da solo" — and it is one number, not ten: raising
 * every column's would leave none of them the largest.
 *
 * **It does not reach `--num-xl`, and §11 asks for it.** The two numbers of §11
 * compete for the same height and the cells win, which is the choice this file
 * makes and the document now records: a 56px figure on the on-turn column sets
 * the height of the whole `<thead>` row — one costs exactly what ten cost, since
 * a row is as tall as its tallest cell — and at 2560×1440 the board finishes
 * with 7,8px to spare, so there is no room to buy it. What it does instead is a
 * quarter above the heading size: 25px at the low step, 32,5 at the two above.
 *
 * The argument that ten of them would be too many is *not* the reason, and it
 * was written here first: ten figures at 56px cost the same row height as one.
 * The reason ten would be wrong is the other one — none of them would be the
 * largest, and §2 wants exactly one.
 */
function MaxBid({
  team,
  onTurn,
  projected,
}: {
  team: AuctionTeam
  onTurn: boolean
  projected: boolean
}): JSX.Element {
  return (
    <span style={{ fontSize: onTurn ? 'calc(var(--board-head) * 1.25)' : 'var(--board-head)' }}>
      <Figure value={team.maxBid} kind="money" role={projected ? 'projection' : 'large'} />
    </span>
  )
}

type Bought = AuctionTeam['roster'][number]

/**
 * "Celle piene: cognome a 12px e prezzo a destra in ambra a 11px. Celle vuote:
 * un trattino in `--text-disabled`, nessun bordo."
 *
 * `text-chalk-600` and not a `--text-disabled` utility: the semantic text names
 * deliberately stay out of `@theme`, because `--text-*` is Tailwind's namespace
 * for *sizes* and a colour declared there generates `font-size: #62716a`. The
 * bridge is in `base.css`, and T25 is the pass that renames these.
 */
function Cell({
  bought,
  first,
  beyond,
  complete,
  onTurn,
  mine,
  color,
  flashing,
}: {
  bought: Bought | null
  first: boolean
  beyond: boolean
  complete: boolean
  onTurn: boolean
  mine: boolean
  color: string | null
  flashing: boolean
}): JSX.Element {
  return (
    <td
      className={`relative overflow-hidden px-1 ${onTurn ? 'bg-pitch-700' : ''} ${
        first ? 'border-t border-line' : ''
      } ${mine ? 'border-l border-l-line-strong' : ''}`}
      style={{
        height: 'var(--board-cell)',
        /*
          "Reparto completo" as an inset shadow and not a left border, because
          the left border is already spoken for: §10 gives it to "la colonna
          della tua squadra", in `--line-strong`. Two signals on one property do
          not take turns — which of them wins is decided by the order Tailwind
          emits its rules, not by the order they are written here, and the
          measurement showed it: 58 cells carried a 2px left edge in two
          different colours, moss where the rule was meant and `#3C4E44` where
          the owner's column had taken it.

          Different mechanisms, no contest. The shadow also sits inside the cell,
          which is what a band marker should do — the border belongs to the
          column and runs its whole height.
        */
        boxShadow: complete ? 'inset 2px 0 0 var(--confirmed)' : undefined,
      }}
    >
      {flashing && (
        <span
          aria-hidden="true"
          className="flash-row pointer-events-none absolute inset-0"
          style={{ ['--flash' as string]: color ?? 'var(--chalk-dim)' }}
        />
      )}

      {bought === null ? (
        <span className="text-chalk-600" style={{ fontSize: 'var(--board-name)' }} aria-hidden="true">
          —
        </span>
      ) : (
        <span className="relative flex items-baseline gap-1">
          {/*
            No `title` on the cell, and that is a deliberate subtraction. §15
            forbids the native attribute "né per nient'altro", `Glyph` counts the
            debt the app still owes at twenty-four, and this one component would
            have added two hundred and sixty attributes to it — ten teams times
            twenty-five slots, plus the heads. The truncation it would have
            explained reaches three names of 250, measured, and the column
            heading keeps its own because there are ten of those, which is the
            size the rest of the app already uses this idiom at.

            `text-chalk-dim` and not `text-taken` for a player past his role's
            quota: §12 puts `--unavailable` at 3,09:1 on `--pitch-900` and 2,47:1
            on the column on turn, and says in as many words that it "resta un
            colore da riempimento e da icona, mai da testo". §3 says what a
            non-blocking anomaly looks like instead — "un'icona e un testo in
            `--chalk-400`, senza colore" — and invariant 11 in revision is
            exactly that. The band position says the rest: these rows sit past
            the league's own slots, in every column at once.
          */}
          <span
            className={`min-w-0 flex-1 truncate ${beyond ? 'text-chalk-dim' : 'text-chalk'}`}
            style={{ fontSize: 'var(--board-name)' }}
          >
            {bought.name}
            {beyond && <span className="sr-only"> — oltre gli slot del ruolo</span>}
          </span>
          {/*
            "Resta in rosa, marcato", document 2 §7 — and in the board it has to
            be a mark that is *drawn*, not one that waits for a pointer. The row
            panel printed the words `fuori listone`; a 22px cell has no room for
            them, and the projection has no pointer at all, so the mark is a dot
            with its sentence beside it for anyone not looking at the screen.

            Rust on a glyph and not on the name: that is the half of
            `--unavailable` §12 allows, "un colore da riempimento e da icona".

            Not `Glyph`, which exists for exactly this and brings a Radix tooltip
            and a `tabIndex={0}` with it: one tab stop per delisted cell, and an
            interactive element on the screen §11 says must have none.
          */}
          {bought.delisted && (
            <span className="shrink-0 text-taken" style={{ fontSize: 'var(--board-price)' }}>
              <span aria-hidden="true">•</span>
              <span className="sr-only"> {notices.DELISTED()}</span>
            </span>
          )}
          {/* The size on a wrapper and not on `Figure`, which takes a class and
              not a style — and giving it one would be widening a primitive five
              other views share, to serve one caller. */}
          <span className="shrink-0" style={{ fontSize: 'var(--board-price)' }}>
            <Figure value={bought.price} kind="money" role="column" className="text-right" />
          </span>
        </span>
      )}
    </td>
  )
}
