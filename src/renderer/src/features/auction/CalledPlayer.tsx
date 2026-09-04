import Abbr from '@/components/Abbr'
import Figure from '@/components/Figure'
import { useAuctionStore } from '@/stores/auction'
import { spelledOut } from '@shared/domain'
import type { PlayerRow } from '@shared/types'

/**
 * "Mostra in grande il giocatore attualmente chiamato", document 2 §4.9.
 *
 * Chiamato is the player the draft has settled on — the one being bid for right
 * now — and not the last purchase, which the toast already names. That is what
 * makes the mode usable at all with a single window: the auctioneer calls a
 * name, you choose it, and you project while the bidding runs; the price is
 * typed afterwards, on the screen you can type into. The draft survives the trip
 * both ways, which is the whole reason it lives in a store — see the docblock of
 * `stores/auction.ts`, which named T15 before T15 existed.
 *
 * It subscribes to the draft itself rather than taking the id from the view.
 * Only the projected screen mounts this, so the unprojected auction gains no
 * subscription and no render it did not already have — and the auction is the
 * one screen where that is worth a sentence.
 *
 * What is deliberately *not* here: the price as it is typed, which would
 * announce to the table a bid nobody has made; the injury notice, which §4.8 and
 * §9 both put in the assignment panel because it is yours to read before paying;
 * and the search results, which are the zone §4.9 says to hide.
 */
export default function CalledPlayer({ players }: { players: readonly PlayerRow[] }): JSX.Element {
  const chosenPlayerId = useAuctionStore((s) => s.chosenPlayerId)
  // Null when the id names nobody in this listone — an import between one
  // keystroke and the next, which nothing forbids. Same reasoning as the panel.
  const player = chosenPlayerId === null ? null : players.find((p) => p.id === chosenPlayerId) ?? null
  const spelled = player === null ? null : spelledOut(player.name, player.fullName)

  return (
    <section className="projection-scale shrink-0 border-b border-line px-3 py-2">
      {/* Sentence case, like the other four `h2` of this screen — `Assegna`,
          `Rose`, `Obiettivi ancora liberi`, `Cronologia`. Lower case belongs to
          the labels that sit beside a value, such as `turno` in the bar. */}
      <h2 className="label text-[length:var(--proj-small)] text-fg-muted">In asta</h2>

      {/*
        The height is held whether or not somebody is called. Document 2 §2 lists
        exactly three movements the interface is allowed, and a rose grid that
        jumps down a row every time a name is chosen would be a fourth — on the
        screen §1 says must never move under the hand registering a purchase.
      */}
      <div className="flex min-h-[calc(var(--proj-called)*1.25)] items-center gap-3">
        {player === null ? (
          /*
            A empty state is an invitation to act, §8 — and the only person who
            can act is not the table this screen is for. So it says where the way
            out is, in the place it will actually be read: the first projection
            of the evening is nearly always an empty one.
          */
          <p className="text-[length:var(--proj-small)] text-fg-muted">
            Nessun giocatore in asta. Esci dalla proiezione con Ctrl/Cmd+P per sceglierne uno.
          </p>
        ) : (
          <>
            {/* `min-w-0` on the wrapper, or `truncate` on the spelled-out name
                inside keeps the intrinsic width and pushes the role and the
                quotation off the screen — the trap T14 paid for in the header
                above this one. The surname itself does not truncate: the longest
                of the 524 is `Milinkovic-Savic V.`, and this strip is as wide as
                the window. */}
            <span className="flex min-w-0 flex-1 items-baseline gap-3">
              <span className="shrink-0 text-[length:var(--proj-called)] leading-tight">
                {player.name}
              </span>
              {/*
                The debt T14b left, and the reason it is paid here: this is the
                one screen of the auction that is read by people who did not
                type. The listone names by surname — 407 of the 524 names are a
                single word, and 89 carry a disambiguating abbreviation — so in
                large it says `Martinez L.` while the auctioneer is shouting
                "Lautaro". `spelledOut` answers null when the full name adds
                nothing, which is what keeps `Bremer · Bremer` off the wall.

                Inline, and on the same line, for a reason the vertical budget
                decides: 25 slots of board do not fit a 1080p projector as it is,
                so a second line here would be taken out of the rose it exists to
                support. It also cannot jump — a line appearing when a name has a
                full form would shift the whole board down, which is the movement
                §2 does not list.

                T14b chose inline in the players table on the premise that the
                full name concerns "few rows", and the premise was backwards.
                Here it is assumed to be there for everybody, and the line box
                holds it either way.

                Not visible today: `full_name` comes only from FBref, the
                optional stage of T6 has never run, and the field is null for all
                524. So this renders exactly as before until that stage runs —
                which is a limit of the data, not of the code, and it is written
                here so the next reader does not take a quiet screen for a bug.

                `text-fg` and not `text-fg-muted`: §11 raises the contrast of
                secondary text from `--chalk-400` to `--chalk-100`, and this is
                the projection band.
              */}
              {/*
                The middle dot, which the other four places that draw this pair
                all write — `AssignPanel`, `PlansView`, `review/Row` — and which
                document 2 §4.8 writes into the form itself: "`Zortea` diventa
                `Zortea · Nadir Zortea`". Here it does more work than there: §11
                takes the attenuation away (secondary text goes to `--chalk-100`
                in projection), so without the dot two names in the same colour,
                12px apart, read as two entries at three metres.

                The value `spelledOut` returns and not `player.fullName`: today
                they are the same string, and the other four callers draw the
                return. One copy reading the field directly is the one that comes
                apart in silence the day the function starts normalising what it
                gives back.
              */}
              {spelled !== null && (
                <span className="min-w-0 truncate text-[length:var(--proj-small)] leading-tight text-fg">
                  · {spelled}
                </span>
              )}
            </span>
            <span className="label shrink-0 text-[length:var(--proj-small)] text-fg-muted">
              {player.roleClassic} · {player.teamCode ?? player.teamName}
              {/*
                The one figure on this screen that had not even tabular digits:
                interpolated into a string, it wore whatever the label around it
                happened to wear. `role="projection"` is Archivo at width 125,
                which §11 asks for — and the family has to come from the role
                rather than from a size, because `--proj-small` is not one of
                §4's four number tokens: it is this screen's own step, moved by
                the `min-height` media queries in `base.css`.

                That step is 13px in the window as it opens, 15 at 760 and 17 at
                1080, so this is Archivo under §4's 20px floor and it is chosen
                rather than overlooked: every figure of the projection band wears
                the projection role — `RosterGrid` says as much beside its own
                `figureRole`, and its roster prices are Archivo at this very
                size — and one Plex figure among them would read as a piece of a
                different screen. T24 rewrites the projection scale, and the
                floor is its problem to settle for the whole band at once.

                `money`, because a quotazione is a price in credits; the amber
                lands on the figure and never on the word, §15.

                `animate={false}`: the number changes only when the called player
                changes, so a count-up would travel between two different men's
                quotazioni — a movement document 2 §2 does not list, three metres
                wide, describing nothing that happened.

                `Abbr` draws no popover here, and that is right rather than
                lucky: this component is mounted only by the auction screen, at
                `/lega/:id/asta` with the league in `auction`, which is exactly
                what `useDense()` answers true to — so it goes quiet, and §11
                keeps its "nessun elemento interattivo visibile". The hidden
                expansion stays either way, which is the half a screen reader
                needs.
              */}
              {player.qtClassicCurrent !== null && (
                <>
                  {' · '}
                  <Abbr name="qt." />{' '}
                  <Figure
                    value={player.qtClassicCurrent}
                    kind="money"
                    role="projection"
                    animate={false}
                  />
                </>
              )}
            </span>
          </>
        )}
      </div>
    </section>
  )
}
