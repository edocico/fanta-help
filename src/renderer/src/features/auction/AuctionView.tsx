import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import { isMod, isTypingTarget } from '@/lib/keys'
import { useAuctionStore } from '@/stores/auction'
import { useLeagueStore } from '@/stores/league'
import { useProjectionStore } from '@/stores/projection'
import Figure from '@/components/Figure'
import Toast from '@/components/Toast'
import { canStartAuction, canTransition } from '@shared/domain'
import { credits, errorMessages, notices } from '@shared/errors'
import type { AuctionState } from '@shared/types'
import { FORMAT_LABELS, MODE_LABELS, STATUS_LABELS } from '@/features/leagues/labels'
import AssignPanel, { type AssignInput } from './AssignPanel'
import CalledPlayer from './CalledPlayer'
import FreeTargets from './FreeTargets'
import History from './History'
import RosterPane from './RosterPane'

/**
 * Asta live, document 2 §4.8: "schermo intero, tre zone".
 *
 * The screen the whole app exists for, and the one §1 writes its five rules
 * about: no modal, undo instead of confirm, the numbers are the content, and
 * every choice that slows the entry down is wrong even when it looks better.
 *
 * Everything is one query. `auction.state` carries the rose grid, the header
 * counts, the turn, the free objectives and the last purchase, and every
 * mutation answers with the whole of it — so the cache is *written* rather than
 * invalidated, as in T11 and T12. Document 3 §4 says the purchase should also
 * invalidate `player.list`; it must not, and the reason is visible in the
 * handler: `player.list` reads the listone and the history, which a purchase
 * does not touch. Refetching six hundred rows two hundred times in an evening
 * would buy nothing at all.
 */
export default function AuctionView(): JSX.Element {
  const params = useParams()
  const id = window.Number(params.id)
  const setActive = useLeagueStore((s) => s.setActiveLeague)
  const openDraft = useAuctionStore((s) => s.open)

  const state = useQuery({
    queryKey: ['auction.state', id],
    queryFn: () => call('auction.state', { leagueId: id }),
    enabled: Number.isInteger(id),
  })

  useEffect(() => {
    if (!Number.isInteger(id)) return
    setActive(id)
    // Throws away a draft typed for another league's auction.
    openDraft(id)
  }, [id, setActive, openDraft])

  if (state.isPending) return <Frame>{null}</Frame>

  if (state.isError) {
    return (
      <Frame>
        <p className="text-base text-taken">
          {state.error instanceof IpcError ? state.error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Frame>
    )
  }

  if (state.data === null) {
    return (
      <Frame>
        <p className="text-base text-chalk-dim">{errorMessages.LEAGUE_MISSING()}</p>
      </Frame>
    )
  }

  if (state.data.league.status !== 'auction') return <Closed state={state.data} />

  return <Live state={state.data} />
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="p-6">
      <h1 className="pb-4 text-lg">Asta</h1>
      {children}
    </div>
  )
}

/**
 * The screen before the auction opens, and after it closes.
 *
 * Invariant 8 lives in the service and this only greys the button out: the two
 * conditions shown are `canStartAuction`, the very function `auction.start`
 * calls inside its transaction.
 */
function Closed({ state }: { state: AuctionState }): JSX.Element {
  const queryClient = useQueryClient()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = canStartAuction({ teams: state.teams.length, slots: state.slots })
  const startable = canTransition(state.league.status, 'auction')

  async function start(): Promise<void> {
    setBusy(true)
    setRefusal(null)
    try {
      queryClient.setQueryData(['auction.state', state.league.id], await call('auction.start', { leagueId: state.league.id }))
      void queryClient.invalidateQueries({ queryKey: ['league.list'] })
      void queryClient.invalidateQueries({ queryKey: ['league.get', state.league.id] })
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame>
      <p className="pb-1 text-base text-chalk-dim">
        {state.league.name} · {MODE_LABELS[state.league.mode]} ·{' '}
        {FORMAT_LABELS[state.league.auctionFormat]} · {STATUS_LABELS[state.league.status]}
      </p>

      {startable ? (
        <>
          <p className="max-w-xl pb-4 pt-2 text-base text-chalk-dim">
            Aprire l’asta blocca il regolamento e l’elenco delle squadre, e chiude l’import del
            listone. Da qui in poi si registrano gli acquisti.
          </p>
          <button
            className="rounded-md border border-line bg-pitch-700 px-3 py-2 text-base disabled:opacity-40"
            disabled={!ready || busy}
            onClick={() => void start()}
          >
            Apri l’asta
          </button>
          {!ready && (
            <p className="pt-2 text-sm text-taken">
              {state.teams.length < 2
                ? errorMessages.TOO_FEW_TEAMS()
                : errorMessages.LEAGUE_SLOTS_EMPTY()}
            </p>
          )}
        </>
      ) : (
        <p className="max-w-xl pt-2 text-base text-chalk-dim">
          {state.league.status === 'review'
            ? 'L’asta è chiusa. Gli acquisti si correggono nella revisione.'
            : state.league.status === 'closed'
              ? errorMessages.LEAGUE_FROZEN()
              : 'Il regolamento non è ancora completo: finiscilo nella scheda Squadre.'}
        </p>
      )}

      {refusal !== null && <p className="pt-3 text-base text-taken">{refusal}</p>}
    </Frame>
  )
}

/** What the toast names, and what `Ctrl/Cmd+Z` would take back. */
type Registered = { purchaseId: number; teamId: number; text: string }

function Live({ state }: { state: AuctionState }): JSX.Element {
  const queryClient = useQueryClient()
  /**
   * The same key shape PlayersView and PlansView use — `{ seasonId }` and not a
   * bare string. Two shapes are two cache entries under `staleTime: Infinity`:
   * the listone would be fetched again on opening the auction even though the
   * players view is already holding it, and a future `setQueryData` on one would
   * be invisible to the other.
   */
  const players = useQuery({
    queryKey: ['player.list', { seasonId: state.league.seasonId }],
    queryFn: () => call('player.list', { seasonId: state.league.seasonId }),
  })

  const [refusal, setRefusal] = useState<string | null>(null)
  const [last, setLast] = useState<Registered | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  /**
   * Bumped to send the focus back to the search box from outside the panel.
   *
   * A token and not a ref handed upwards: the panel owns its input, and this
   * only says "now" — which is all `Esc` and a finished purchase have to say.
   */
  const [focusToken, setFocusToken] = useState(0)
  const clearRefusal = useCallback(() => setRefusal(null), [])

  const projected = useProjectionStore((s) => s.on)
  const leaveProjection = useProjectionStore((s) => s.leave)
  const toggleProjectionState = useProjectionStore((s) => s.toggle)

  /**
   * Document 2 §4.9, the button and `Ctrl/Cmd+P`.
   *
   * Entering closes the history: a 384px panel lying over the very grid §4.9
   * says to enlarge is the one thing this mode cannot show. It does not come
   * back on the way out either — a panel that reappears over the board three
   * minutes later, while a name is being called, is worse than one to reopen
   * with two keys.
   */
  const toggleProjection = useCallback((): void => {
    setHistoryOpen(false)
    toggleProjectionState()
  }, [toggleProjectionState])

  /**
   * Leaving the auction leaves the mode.
   *
   * The store outlives this component on purpose — it is not the draft — so
   * without this, coming back to the auction an hour later would open on a board
   * with no search box, on the evening with no time to wonder why.
   */
  useEffect(() => leaveProjection, [leaveProjection])

  const absorb = useCallback(
    (next: AuctionState): void => {
      queryClient.setQueryData(['auction.state', state.league.id], next)
      // The home draws a progress bar out of `slotsFilled`, and the register
      // grows on every write. Neither is on screen here, so both are marked
      // stale rather than refetched.
      void queryClient.invalidateQueries({ queryKey: ['league.list'] })
      void queryClient.invalidateQueries({ queryKey: ['auction.history', state.league.id] })
    },
    [queryClient, state.league.id],
  )

  async function assign(input: AssignInput): Promise<boolean> {
    setRefusal(null)
    try {
      const next = await call('auction.assign', { leagueId: state.league.id, ...input })
      absorb(next)
      const bought = next.lastPurchase
      if (bought) {
        setLast({
          purchaseId: bought.purchaseId,
          teamId: bought.fantaTeamId,
          // Document 2 §5, word for word: "Lautaro Martinez → Real Fanta, 47 crediti".
          text: `${bought.name} → ${bought.teamName}, ${credits(bought.price)}`,
        })
      }
      return true
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
      return false
    }
  }

  /**
   * `Ctrl/Cmd+Z`, and the Annulla of the toast: the same call, because §5 says
   * the shortcut works "in qualsiasi momento, anche a toast scaduto".
   *
   * The toast is cleared whatever happens. On success the purchase it names is
   * gone; on a refusal — nothing left to undo, someone else's auction closed
   * underneath — the sentence under it is the answer, and a toast still offering
   * to undo would be inviting the same refusal again.
   */
  const undo = useCallback(async (): Promise<void> => {
    setRefusal(null)
    setLast(null)
    try {
      absorb(await call('auction.undo', { leagueId: state.league.id }))
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    }
  }, [absorb, state.league.id])

  /**
   * The keyboard of §6 that belongs to the auction rather than to one field.
   *
   * `Esc` is here and **only** here. It used to live on the three inputs of the
   * panel as well, which had two faults at once: it did nothing when the focus
   * was anywhere else — on a roster row, say, which is a button and takes focus
   * on click — while §6 scopes `Esc` to "asta" and not to "assegnazione"; and
   * with the history open one press did both jobs, because React delegates
   * `onKeyDown` to the root and the event went on bubbling to this listener. One
   * listener, one meaning, and an explicit precedence: the panel closes first,
   * and only a second `Esc` throws the entry away.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (historyOpen) {
          setHistoryOpen(false)
          return
        }
        useAuctionStore.getState().reset()
        setRefusal(null)
        setFocusToken((n) => n + 1)
        return
      }
      /**
       * `/` and `Ctrl/Cmd+K` are "vai alla ricerca" in §6, and in projection
       * there is no search box to go to — the panel that owns that listener
       * (`AssignPanel`) is unmounted, so both keys are simply dead. Here they
       * mean "get me back to where I can type", which is the same intention one
       * key earlier. Guarded by `projected` precisely because the panel's own
       * listener is alive the rest of the time, and two handlers for one key
       * would fight over the same field.
       *
       * The focus needs no help afterwards, and lands in two different places
       * on purpose. The panel focuses the search box on mount; its later effect
       * — declared after, so it wins — moves on to the price when a player is
       * already chosen. So with an empty draft these keys mean what §6 says,
       * "vai alla ricerca", and with a player called they land on the price,
       * which is where the flow actually continues: you projected while the
       * bidding ran, and the bidding is what just ended. Verified in the running
       * app, not deduced. No `requestAnimationFrame` anywhere near it.
       */
      if (projected && e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault()
        leaveProjection()
        return
      }

      if (!isMod(e)) return
      const key = e.key.toLowerCase()
      if (key === 'p') {
        e.preventDefault()
        toggleProjection()
      }
      if (key === 'k' && projected) {
        e.preventDefault()
        leaveProjection()
      }
      if (key === 'z') {
        e.preventDefault()
        void undo()
      }
      if (key === 'h') {
        e.preventDefault()
        // The history is for correcting, and correcting needs the panel: from
        // projection the key carries you where you can act instead of opening a
        // column of timestamps over the board for the table to read.
        if (projected) leaveProjection()
        setHistoryOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, historyOpen, projected, leaveProjection, toggleProjection])

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TopBar
        state={state}
        projected={projected}
        onAbsorb={absorb}
        onRefusal={setRefusal}
        onHistory={() => setHistoryOpen((o) => !o)}
        onProjection={toggleProjection}
      />

      {/*
        A refusal has exactly one reader — the assignment panel — and projection
        unmounts it, so without this line `Ctrl/Cmd+Z` stays live, goes on being
        refusable, and says nothing when it is refused: "Non c'è niente da
        annullare." would land on a screen with nobody to print it, and a key
        that answers with silence reads as a key that is broken. §6 scopes the
        undo to "asta", not to the panel, so the answer had to follow it here
        rather than the shortcut being switched off.

        It clears itself: `undo()` blanks it before trying again, and leaving the
        mode remounts the panel, whose mount effect calls `onEdit`.
      */}
      {projected && refusal !== null && (
        <p className="shrink-0 border-b border-line px-3 py-2 text-base text-taken">{refusal}</p>
      )}

      {/* Full width and above the row, so the name has the whole screen: it is
          "in grande" of §4.9, and after it the grid has nothing beside it. */}
      {projected && <CalledPlayer players={players.data?.players ?? []} />}

      <div className="relative flex min-h-0 flex-1">
        {/*
          Unmounted, not hidden — an input still in the tree, focused and off
          screen, would go on swallowing the keys meant for the board. And
          rendered *in its place* rather than around the grid: written as a
          wrapper, every `Ctrl+P` would remount `RosterGrid` and empty the set of
          expanded rosters somebody had just opened to check a price.

          The draft it holds survives regardless, in the store — which is why
          `stores/auction.ts` keeps it there and says so.
        */}
        {!projected && (
          <div className="flex w-80 min-w-0 shrink-0 flex-col border-r border-line bg-pitch-800">
            <AssignPanel
              state={state}
              players={players.data?.players ?? []}
              playersError={
                players.isError
                  ? players.error instanceof IpcError
                    ? players.error.message
                    : errorMessages.IPC_UNAVAILABLE()
                  : null
              }
              refusal={refusal}
              focusToken={focusToken}
              onEdit={clearRefusal}
              onAssign={assign}
            />
            <FreeTargets targets={state.targetsFree} />
          </div>
        )}

        {/*
          The grid is the flex item itself, with no wrapper. A `<div flex-1>`
          around it was stretched to the row's height while the `<section>`
          inside kept `height: auto`, so its `overflow-auto` list never had a
          height to overflow: nothing scrolled internally and the whole screen
          scrolled instead — the top bar and the search field that §4.8 says is
          always focused went off the top of the window.
        */}
        <RosterPane state={state} last={last} projected={projected} />

        {/*
          The history lies **over** the grid rather than beside it. At the
          window's narrowest, 1100, 40 (retracted bar) + 320 (panel) + 384
          (history) leave the roses 356px — three columns of a ten-team board,
          and the fallback list is already what shows at that width. At 900,
          which is where the window opened before T24, it was 156px and a team
          name measured zero. Either way the roses are half of §4.8. Overlaying costs nothing: the assignment panel
          stays where it was and goes on working, which is the only thing §1
          refuses to slow down.
        */}
        {historyOpen && (
          <div className="absolute inset-y-0 right-0 z-20 flex max-w-full">
            <History
              leagueId={state.league.id}
              teams={state.teams}
              onClose={() => setHistoryOpen(false)}
            />
          </div>
        )}
      </div>

      {/*
        Bottom centre, over everything, and clicking through everywhere it is not
        — §1 forbids anything that steals the screen during the auction.
        Keyed on the purchase so a second one restarts the ten seconds instead of
        inheriting what is left of the first one's.
      */}
      {last !== null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
          <Toast
            key={last.purchaseId}
            message={last.text}
            onUndo={() => void undo()}
            onDismiss={() => setLast(null)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * "Lega degli Amici · Classic · a chiamata      Turno: Real Fanta   142/200"
 *
 * The count is two numbers and not a percentage, for the reason `leagueSummary`
 * gives in the contracts: at the start of the evening a percentage rounds to
 * zero and says nothing, while "18 su 250" says exactly where the room is.
 */
function TopBar({
  state,
  projected,
  onAbsorb,
  onRefusal,
  onHistory,
  onProjection,
}: {
  state: AuctionState
  projected: boolean
  onAbsorb: (next: AuctionState) => void
  onRefusal: (message: string | null) => void
  onHistory: () => void
  onProjection: () => void
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const turn = state.teams.find((t) => t.id === state.currentTurnTeamId) ?? null
  const incomplete = state.teams.filter((t) => !t.complete).length

  /**
   * The half-given consent does not wait behind the mode.
   *
   * Hiding the row alone would leave `confirming` true underneath, so a click on
   * "Chiudi l'asta", a glance at the projector and a way back would land on a
   * live `[Chiudi]` next to a question asked minutes ago and already forgotten.
   */
  useEffect(() => {
    if (projected) setConfirming(false)
  }, [projected])

  async function run(what: () => Promise<AuctionState>): Promise<void> {
    onRefusal(null)
    try {
      onAbsorb(await what())
    } catch (e) {
      onRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    }
  }

  /**
   * The arrow of document 2 §9: "il turno nell'asta a chiamata si mostra ma non
   * avanza da solo. C'è una freccia per farlo avanzare a mano."
   *
   * One place along the league order, wrapping — and **not** skipping the teams
   * whose roster is complete. That is what `stepTurn` does in the service when a
   * draft advances by itself, and two different answers to "who is next" would
   * make the same league behave differently depending on which of the two moved
   * the turn.
   */
  function nextTurn(): void {
    if (state.teams.length === 0) return
    const at = state.teams.findIndex((t) => t.id === state.currentTurnTeamId)
    const next = state.teams[(at + 1 + state.teams.length) % state.teams.length]
    void run(() =>
      call('auction.setTurn', { leagueId: state.league.id, fantaTeamId: next.id }),
    )
  }

  return (
    <>
      {/*
        Every item after the league name used to be `shrink-0`, and two of them
        were unbounded: a 47-character team name measured 363px inside a
        `shrink-0` parent, where the default `min-width: auto` keeps a `truncate`
        span from ever truncating, and names are allowed sixty characters. With
        the close confirmation open the header needed 922px of the 860 available
        and its buttons fell outside the window. Now the two names share what is
        left and the confirmation has a row of its own.
      */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-base">
          {state.league.name}{' '}
          <span className="label text-micro text-chalk-dim">
            {MODE_LABELS[state.league.mode]} · {FORMAT_LABELS[state.league.auctionFormat]}
          </span>
        </span>

        <span className="flex min-w-0 max-w-56 shrink items-center gap-2 text-base">
          <span className="label shrink-0 text-micro text-chalk-dim">turno</span>
          <span className="min-w-0 truncate">{turn?.name ?? 'nessuno'}</span>
          {state.league.auctionFormat === 'call' && (
            <button
              className="shrink-0 rounded-md border border-line px-1.5 leading-none text-chalk-dim hover:text-chalk"
              title="passa il turno alla squadra successiva"
              aria-label="passa il turno alla squadra successiva"
              onClick={nextTurn}
            >
              ▸
            </button>
          )}
        </span>

        {/* Slots and not credits, so `whole`: no amber — §15 keeps it for money
            — and no count-up, which §7 gives to the credits figure alone. Two
            `Figure`s and not one span holding "142/200": they are two numbers,
            as the comment above this component says, and only the first of them
            moves. */}
        <span className="shrink-0 text-base">
          <Figure value={state.assigned} />/<Figure value={state.slotsTotal} />
        </span>

        {/* "Attivabile da un pulsante nella barra superiore o con Ctrl/Cmd+P",
            §4.9. Both ways in, and the button is also the only way out that
            needs nothing remembered — so it stays visible in projection, where
            the two beside it do not. */}
        <button
          className="label shrink-0 rounded-md border border-line px-2 py-1 text-micro text-chalk-dim hover:text-chalk"
          onClick={onProjection}
          aria-pressed={projected}
          title="Ctrl/Cmd+P"
        >
          {projected ? 'Esci dalla proiezione' : 'Proiezione'}
        </button>

        {/*
          Both gone in projection, and only the second one is a real decision.
          The history is a column of timestamps for correcting later: on a
          television it is noise to the table and useless to you.

          "Chiudi l'asta" is the door that does not open again — `auction` →
          `review` only goes forward — and two gestures reach it: click, then
          `Ctrl+P`, and the room is looking at "3 squadre hanno slot liberi.
          Chiudere lo stesso?" with a live [Chiudi] under the hand hunting for
          the projection key. §4.9 does not authorise hiding anything but the two
          zones, so this is a decision beyond the document rather than a reading
          of it — taken because the alternative is unrecoverable.
        */}
        {!projected && (
          <>
            <button
              className="label shrink-0 rounded-md border border-line px-2 py-1 text-micro text-chalk-dim hover:text-chalk"
              onClick={onHistory}
              title="Ctrl/Cmd+H"
            >
              Cronologia
            </button>

            <button
              className="label shrink-0 rounded-md border border-line px-2 py-1 text-micro text-chalk-dim hover:text-chalk"
              onClick={() => {
                // With every roster full there is nothing to warn about, so the
                // first click closes: §7 attaches the warning to the free slots.
                if (incomplete === 0)
                  void run(() => call('auction.close', { leagueId: state.league.id }))
                else setConfirming(true)
              }}
            >
              Chiudi l’asta
            </button>
          </>
        )}
      </header>

      {/*
        "Chiudi asta con rose incomplete → permesso, con avviso", §7. Inline and
        in two clicks rather than a dialog, because §1 forbids modals here — and
        on its own row, because the sentence carries a number and the header has
        no room left to give it.
      */}
      {/* `!projected` as well as the effect above: an effect runs after the
          commit, so the gate alone would flash the question onto the projector
          for one frame on the way in. */}
      {confirming && !projected && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-sm">
          <span className="text-taken">{notices.CLOSE_WITH_FREE_SLOTS({ n: incomplete })}</span>
          <button
            className="rounded-md border border-line px-2 py-1"
            onClick={() => {
              setConfirming(false)
              void run(() => call('auction.close', { leagueId: state.league.id }))
            }}
          >
            Chiudi
          </button>
          <button className="text-chalk-dim hover:text-chalk" onClick={() => setConfirming(false)}>
            Annulla
          </button>
        </div>
      )}
    </>
  )
}
