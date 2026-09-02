import { useEffect, useMemo, useRef, useState } from 'react'
import { haystack, search as fuzzy } from '@/features/players/search'
import { isMod, isTypingTarget } from '@/lib/keys'
import { useAuctionStore } from '@/stores/auction'
import { checkPurchase, normalizeName, type ClassicRole } from '@shared/domain'
import { errorMessages, notices, violationMessage } from '@shared/errors'
import type { AuctionState, AuctionTeam, PlayerRow } from '@shared/types'

/**
 * The assignment panel of document 2 §4.8, and the flow of §5 — which is the one
 * interaction that document says must be "progettata al tasto".
 *
 *   1. il fuoco è già nel campo di ricerca
 *   2. digiti due o tre lettere, il primo risultato è preselezionato
 *   3. ↓ ↑ per cambiare, Invio per scegliere → il fuoco passa al prezzo
 *   4. digiti il prezzo, Invio → il fuoco passa alla squadra, precompilata
 *   5. Invio conferma, il fuoco torna alla ricerca, il campo è vuoto
 *
 * Three Enters and a name. Everything here exists to keep that true: no modal
 * (§1), no field that only delivers on blur (the trap CLAUDE.md records, which
 * would leave the button disabled at the moment of the click), and no confirm
 * step — the purchase is written immediately and the toast offers the undo.
 *
 * The refusals are shown before the Enter and *not decided* here. `checkPurchase`
 * is the same pure function the service runs inside its transaction, and
 * `violationMessage` the same sentence: rule 2 of CLAUDE.md, the interface greys
 * the button out as a courtesy and the service refuses for real.
 *
 * The draft lives in the store of document 3 §4, not in this component, so a
 * refused assignment leaves it intact — "puoi correggere il prezzo senza
 * ridigitare il nome".
 */

/** Enough to choose from without becoming a list to read. */
const MAX_RESULTS = 8

export type AssignInput = { playerId: number; fantaTeamId: number; price: number }

export default function AssignPanel({
  state,
  players,
  playersError,
  refusal,
  focusToken,
  onEdit,
  onAssign,
}: {
  state: AuctionState
  players: readonly PlayerRow[]
  /** The listone failed to load: the search cannot mean anything until it does. */
  playersError: string | null
  /** What the main process refused, if the last attempt was refused. */
  refusal: string | null
  /** Bumped when something outside the panel wants the search box focused. */
  focusToken: number
  /** Called when the draft changes, so a stale refusal can be dropped. */
  onEdit: () => void
  /** Resolves true when the purchase was written: only then is the draft cleared. */
  onAssign: (input: AssignInput) => Promise<boolean>
}): JSX.Element {
  /**
   * The whole store, in one subscription rather than nine selectors: every field
   * of the draft is read by this component and most keystrokes touch two of
   * them, so a selector each would be nine comparisons to save a render that
   * happens anyway.
   */
  const {
    step,
    query,
    highlight,
    chosenPlayerId,
    price,
    teamDraft,
    teamHighlight,
    setQuery,
    setHighlight,
    choose: pick,
    setPrice,
    setTeam,
    setTeamHighlight,
    setStep,
    reset,
  } = useAuctionStore()

  /** In flight, not a draft: it belongs to this component and dies with it. */
  const [busy, setBusy] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const priceRef = useRef<HTMLInputElement>(null)
  const teamRef = useRef<HTMLInputElement>(null)
  /** `max-h-24` shows about three teams; the arrows cycle through all of them. */
  const teamRow = useScrollIntoView<HTMLButtonElement>(teamHighlight)

  const index = useMemo(() => haystack(players), [players])
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  // Null when the id names nobody in this listone — an import between one
  // keystroke and the next, which nothing forbids.
  const chosen = chosenPlayerId === null ? null : byId.get(chosenPlayerId) ?? null

  /**
   * Who already owns whom, and for how much — the left-hand side of the first
   * row of document 2 §7: "appare nei risultati ma non selezionabile, riga
   * attenuata, «Già a Bomber Team per 34»".
   *
   * Built from the state rather than asked of the main process, because the
   * state is where it already is: every mutation answers with the whole board.
   */
  const owners = useMemo(() => {
    const map = new Map<number, { team: string; price: number }>()
    for (const team of state.teams) {
      for (const bought of team.roster) {
        map.set(bought.playerId, { team: team.name, price: bought.price })
      }
    }
    return map
  }, [state.teams])

  /** The rows Enter may land on: everything but a player somebody already has. */
  const selectable = (p: PlayerRow): boolean => !owners.has(p.id)

  // Searched once per keystroke, not twice: the count under the list and the
  // list itself are two readings of the same answer.
  const matches = useMemo(() => (query.trim() === '' ? [] : fuzzy(index, query)), [index, query])
  const results = useMemo(() => matches.slice(0, MAX_RESULTS), [matches])

  /**
   * Where Enter would actually land.
   *
   * `highlight` goes back to 0 on every keystroke, and row 0 is quite often a
   * player somebody already bought — a fuzzy search ranks by name, not by
   * availability. Without this the preselection §5 promises ("il primo è
   * preselezionato") would sit on an unselectable row, and the first Enter of
   * the evening would do nothing.
   */
  const at =
    results[highlight] && selectable(results[highlight])
      ? highlight
      : results.findIndex(selectable)

  /**
   * «Rosa completa → la squadra sparisce dal selettore», documento 2 §7 — ma in
   * revisione no.
   *
   * L'invariante 11 declassa il tetto per ruolo ad avviso, e §4.10 chiede
   * l'opposto del selettore d'asta: mentre si sistema un errore capita di
   * dovere aggiungere una riga proprio alla squadra che ha già tutti gli slot
   * pieni, ed è il pannello dei controlli a dirlo, non un elenco che la nasconde.
   */
  const teams = useMemo(
    () =>
      state.league.status === 'review' ? state.teams : state.teams.filter((t) => !t.complete),
    [state.teams, state.league.status],
  )
  const turn = teams.find((t) => t.id === state.currentTurnTeamId) ?? null

  /**
   * Lo stesso pannello, con un altro nome sopra.
   *
   * In asta si assegna un giocatore appena chiamato; in revisione si aggiunge
   * una riga dimenticata, e il §4.10 quel controllo lo chiama «+ Aggiungi un
   * acquisto». Ricavato dallo stato invece che passato come prop: la vista che
   * lo rende non deve poter dire una cosa diversa dal database.
   */
  const aggiunta = state.league.status === 'review'

  const teamMatches = useMemo(() => {
    const needle = normalizeName(teamDraft)
    if (needle === '') return teams
    const starts = teams.filter((t) => normalizeName(t.name).startsWith(needle))
    // Prefix first, then anything merely containing it: typing "real" should not
    // offer "Zona Reale" ahead of "Real Fanta".
    const rest = teams.filter((t) => !starts.includes(t) && normalizeName(t.name).includes(needle))
    return [...starts, ...rest]
  }, [teams, teamDraft])

  const teamAt = Math.min(teamHighlight, teamMatches.length - 1)

  /**
   * The buying team, and **null while the field is empty**.
   *
   * That guard is the whole of this line. `teamMatches` answers with every
   * incomplete team when the needle is empty, so without it `team` was
   * `teams[0]` — and since `blocked` below only asks `team !== null`, the third
   * Enter of §5 wrote a purchase for the first team in league order, silently,
   * for a team nobody had named.
   *
   * It was not a corner: `choose` prefills `turn?.name ?? ''`, and `turn` is
   * looked up among the *incomplete* teams, so the moment the team on turn fills
   * its roster — routine in the last rounds of a draft, where `stepTurn`
   * advances onto complete teams by design — every pick arrived with an empty
   * box. Refusing to guess is the only safe answer: §5 has the reader confirm
   * "se va bene, Invio", and Enter must never confirm something the field never
   * showed.
   */
  const team: AuctionTeam | null =
    teamDraft.trim() === '' ? null : teamMatches[teamAt] ?? null

  /**
   * Why the typed name matches nothing — the second half of the "rosa completa"
   * row of document 2 §7, whose first half is the team leaving the selector.
   *
   * Without it that row is only half implemented: the team disappears and the
   * field silently refuses to resolve, which reads as a broken search box rather
   * than as a roster that is full. The sentence is written here and not in
   * `errorMessages` because no service ever raises it — a complete roster reaches
   * the main process as `ROLE_SLOTS_FULL`, and adding a code nothing throws would
   * put an unreachable branch in the file that promises every code is a refusal.
   */
  const full =
    team === null && teamDraft.trim() !== ''
      ? state.teams.find(
          (t) => t.complete && normalizeName(t.name).includes(normalizeName(teamDraft)),
        ) ?? null
      : null

  /**
   * The price as an integer, or null while the field is empty.
   *
   * A digits-only text field rather than `type="number"`, which is what
   * PriceField uses and then has to truncate: there the value is edited in a
   * quiet screen, here `,`, `.`, `e` and `-` are four ways to lose a second
   * during the one interaction §1 says must never be slowed down. Nothing that
   * is not a digit ever reaches the store.
   */
  const priceValue = price === '' ? null : Number(price)

  /**
   * The refusal the service would raise, computed before the Enter.
   *
   * The first blocking violation and not all of them, which is what `assign`
   * does — `violations.find((v) => v.blocking)` — so the sentence on screen is
   * the sentence that would come back. §7 gives credits and maximum bid separate
   * rows for a reason `checkPurchase` documents: printed together, the precise
   * one makes an eighty-credit problem look like a thirteen-credit one.
   */
  /**
   * La severità viene dallo stato, e in revisione **niente blocca**.
   *
   * `checkPurchase` porta la severità come parametro proprio per l'invariante
   * 11, e in `advisory` nessuna violazione ha `blocking: true`: la `find` qui
   * sotto torna `null`, la frase rossa non compare e il bottone resta acceso.
   * Senza questa riga il servizio accettava e l'interfaccia no — il §4.10 chiede
   * l'opposto: «mentre sposti un giocatore da una squadra all'altra la seconda è
   * per forza sforata per un istante».
   *
   * E in revisione la frase non serve nemmeno come avviso: i crediti di una
   * squadra sforata sono negativi, e `INSUFFICIENT_CREDITS` direbbe «Real Fanta
   * ha -4 crediti», che in asta non era raggiungibile. Il pannello controlli lo
   * dice meglio a due dita di distanza — «sforato di 4 crediti» — e si aggiorna
   * da sé appena l'acquisto entra.
   */
  const violation =
    chosen && team && priceValue !== null
      ? checkPurchase(
          { credits: team.credits, filled: team.filled, slots: state.slots },
          chosen.roleClassic as ClassicRole,
          priceValue,
          state.league.minBid,
          state.league.status === 'review' ? 'advisory' : 'blocking',
        ).find((v) => v.blocking) ?? null
      : null

  const blocked = chosen === null || team === null || priceValue === null || violation !== null || busy

  /** A player is chosen and nobody is named to buy him. */
  const needsTeam = chosen !== null && teamDraft.trim() === ''

  /** After a purchase: an empty search box with the focus already in it, §5. */
  function restart(): void {
    reset()
    searchRef.current?.focus()
  }

  /**
   * "Il campo di ricerca è sempre a fuoco quando la vista si apre", §4.8 — and
   * again whenever `Esc` restarts the entry from outside these three fields,
   * which the view signals by bumping the token.
   */
  useEffect(() => {
    searchRef.current?.focus()
  }, [focusToken])

  /**
   * The focus follows the step, in an effect rather than in the handler that
   * moved it.
   *
   * Two reasons, and the second is a trap. The price field is `disabled` until a
   * player is chosen and a disabled input cannot take the focus, so the hop has
   * to happen after React has committed the enabling render — an effect is
   * exactly that moment. The first version reached for `requestAnimationFrame`
   * instead, and CLAUDE.md records why that is wrong here: with the window
   * occluded rAF does not fire at all, so the focus stayed in the search box and
   * the digits of the price were typed into the player's name. Effects run on
   * the commit, occluded or not.
   */
  useEffect(() => {
    if (step === 'price') priceRef.current?.focus()
    if (step === 'team') {
      // Selected and not merely focused: §5 has the field arrive prefilled with
      // the team on turn, so the next keystroke must replace it whole.
      teamRef.current?.focus()
      teamRef.current?.select()
    }
  }, [step])

  /**
   * A refusal is about one (player, price, team), and stops being true the
   * moment any of the three moves.
   *
   * Without this the red sentence from a refused attempt survived Escape and
   * survived choosing another player, sitting under the panel — naming a team
   * and a figure — through the entire entry of the next purchase.
   */
  useEffect(() => {
    onEdit()
  }, [chosenPlayerId, price, teamDraft, onEdit])

  /**
   * `Ctrl/Cmd+K` and `/`, §6. The listener lives here and not in the view
   * because the field does — and the same pair is registered in the players
   * view, since §6 scopes both to "ovunque".
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const toSearch =
        (isMod(e) && e.key.toLowerCase() === 'k') || (e.key === '/' && !isTypingTarget(e.target))
      if (!toSearch) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function choose(player: PlayerRow): void {
    /**
     * "Il fuoco passa alla squadra, già precompilata con quella di turno", §5.
     *
     * Unless the team on turn has no slots left, or nobody is on turn — which is
     * legal in the call format, where `auction.setTurn` accepts null. Prefilling
     * a completed team would guarantee a refusal on a field the reader was
     * invited to accept with one Enter.
     *
     * E in revisione mai. Il turno non viene azzerato dalla chiusura dell'asta —
     * `closeAuction` tocca solo lo stato — quindi qui dentro sarebbe quello
     * rimasto dall'ultima chiamata, cioè una squadra scelta da un turno che non
     * esiste più. Tre Invio e la riga dimenticata finisce a quella squadra. Il
     * campo vuoto ha già il suo comportamento: `PICK_A_TEAM` chiede di nominarla.
     */
    pick(player.id, state.league.status === 'review' ? '' : (turn?.name ?? ''))
  }

  async function submit(): Promise<void> {
    if (blocked || chosen === null || team === null || priceValue === null) return
    setBusy(true)
    try {
      if (await onAssign({ playerId: chosen.id, fantaTeamId: team.id, price: priceValue })) {
        restart()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex min-h-0 shrink-0 flex-col gap-2 border-b border-line p-3">
      <h2 className="label text-xs text-chalk-dim">
        {aggiunta ? 'Aggiungi un acquisto' : 'Assegna'}
      </h2>

      <input
        ref={searchRef}
        value={query}
        aria-label="cerca un giocatore"
        placeholder="Cerca un giocatore"
        className="w-full rounded-md border border-line bg-pitch-900 px-2 py-1.5 text-sm"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // `Esc` is not here: §6 scopes it to the whole auction, not to the
          // assignment, so one window listener in the view owns it — and owns
          // the precedence against the history panel, which closes on it too.
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight(nextSelectable(results, at, e.key === 'ArrowDown' ? 1 : -1, selectable))
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            const player = results[at]
            if (player && selectable(player)) choose(player)
          }
        }}
      />

      {/*
        A broken `player.list` is not "no results". With `retry: false` and
        `staleTime: Infinity` the query never tries again, so the index stays
        empty for good and the search would answer "Prova con meno lettere" to
        every letter — the §7 line for "hai scritto troppo", said on the one
        screen with no time to investigate, while the channel is down.
      */}
      {playersError !== null && <p className="text-xs text-taken">{playersError}</p>}

      {playersError === null && step === 'player' && query.trim() !== '' && (
        <Results
          results={results}
          matched={matches.length}
          highlight={at}
          owners={owners}
          onPick={choose}
        />
      )}

      {chosen && (
        <>
          <p className="truncate pt-1 text-base text-chalk" title={chosen.name}>
            {chosen.name}{' '}
            <span className="label text-xs text-chalk-dim">
              {chosen.roleClassic} {chosen.teamCode ?? chosen.teamName}
              {chosen.qtClassicCurrent !== null && ` · qt. ${chosen.qtClassicCurrent}`}
            </span>
          </p>
          {chosen.delisted && (
            <p className="text-xs text-taken">{notices.DELISTED()}</p>
          )}
          {/*
            The injury notice of §4.8 — "Infortunato · rientro previsto a novembre
            · dato di 2 giorni fa" — belongs here, above the price field, which is
            where that line puts it: "il pannello lo dice lì, prima del campo
            prezzo". It is absent rather than empty, because the live-data layer
            it reads is T19: nothing fills `player_availability` and no channel
            offers it. §7 rules on exactly this state — "dati infortuni non
            disponibili → colonna e avviso assenti, nessun errore" — so nothing
            is missing here, and when T19 lands the notice has its place.
          */}
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <label className="label w-16 shrink-0 text-xs text-chalk-dim" htmlFor="asta-prezzo">
          prezzo
        </label>
        <input
          id="asta-prezzo"
          ref={priceRef}
          value={price}
          inputMode="numeric"
          disabled={chosen === null}
          placeholder={String(state.league.minBid)}
          className="figures w-20 rounded-md border border-line bg-pitch-900 px-2 py-1 text-right text-sm text-credit disabled:opacity-40"
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (priceValue === null) return
              setStep('team')
            }
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="label w-16 shrink-0 text-xs text-chalk-dim" htmlFor="asta-squadra">
          squadra
        </label>
        <input
          id="asta-squadra"
          ref={teamRef}
          value={teamDraft}
          disabled={chosen === null}
          placeholder="Squadra acquirente"
          className="min-w-0 flex-1 rounded-md border border-line bg-pitch-900 px-2 py-1 text-sm disabled:opacity-40"
          onChange={(e) => setTeam(e.target.value)}
          onKeyDown={(e) => {
            /**
             * "`1`–`9` scegli la squadra n-esima", §6.
             *
             * The number is the team's place in the league order — the order the
             * wizard settled by dragging, which is also the turn — and not its
             * place in whatever the field has filtered down to. Over three hours
             * that number becomes muscle memory, and one that moved every time a
             * roster filled up would be worse than none. A team that has
             * completed its roster leaves a hole, which is the truth.
             */
            if (/^[1-9]$/.test(e.key) && !isMod(e) && !e.altKey) {
              const wanted = state.teams[Number(e.key) - 1]
              if (wanted) {
                // Including one whose roster is full: the field then says so.
                // A key that did nothing would look like a key that is broken.
                e.preventDefault()
                setTeam(wanted.name)
                return
              }
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (teamMatches.length === 0) return
              const move = e.key === 'ArrowDown' ? 1 : -1
              /**
               * From an empty field an arrow *writes a name* rather than moving
               * a highlight.
               *
               * Because with the field empty there is no selection to move: the
               * team resolves to nobody by design, so a highlighted row would be
               * showing a choice that the field does not hold and the button
               * would refuse — which is the same disagreement between what is
               * shown and what is meant that the empty field itself caused.
               * Writing the name makes the field the single answer to "who is
               * buying", and every later arrow moves within the matches as usual.
               */
              if (needsTeam) {
                setTeam(teamMatches[move === 1 ? 0 : teamMatches.length - 1].name)
                return
              }
              setTeamHighlight((teamAt + move + teamMatches.length) % teamMatches.length)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
      </div>

      {step === 'team' && (teamMatches.length > 1 || needsTeam) && (
        <ul className="max-h-24 shrink-0 overflow-auto rounded-md border border-line">
          {teamMatches.map((t, i) => (
            <li key={t.id}>
              <button
                ref={i === teamAt && !needsTeam ? teamRow : undefined}
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                  i === teamAt && !needsTeam ? 'bg-pitch-700' : ''
                }`}
                onClick={() => {
                  setTeam(t.name)
                  teamRef.current?.focus()
                }}
              >
                <span className="figures w-4 text-xs text-chalk-dim">
                  {t.orderIndex < 9 ? t.orderIndex + 1 : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="figures text-xs text-credit">max {t.maxBid}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="w-full rounded-md border border-line bg-pitch-700 px-3 py-2 text-sm disabled:opacity-40"
        disabled={blocked}
        onClick={() => void submit()}
      >
        {aggiunta ? 'Aggiungi' : 'Assegna'} <span className="text-chalk-dim">⏎</span>
      </button>

      {/*
        One sentence at a time, and the live one first. A violation computed here
        and a refusal that came back from the service are two accounts of the
        same attempt; printed together they would disagree the moment the board
        moved between them, and §1 leaves no room for a paragraph.
      */}
      {violation !== null && chosen !== null && team !== null ? (
        <p className="text-xs text-taken">
          {violationMessage(violation, team.name, chosen.roleClassic as ClassicRole)}
        </p>
      ) : full !== null ? (
        <p className="text-xs text-taken">{notices.ROSTER_COMPLETE({ team: full.name })}</p>
      ) : refusal !== null ? (
        <p className="text-xs text-taken">{refusal}</p>
      ) : (
        // Not `taken`: an empty box is not a refusal, it is the step the reader
        // is standing on. It exists because the field no longer guesses.
        needsTeam && <p className="text-xs text-chalk-dim">{notices.PICK_A_TEAM()}</p>
      )}
    </section>
  )
}

/**
 * Keeps the highlighted row inside its scrolling box.
 *
 * The two lists are capped — `max-h-44` fits about six of eight results,
 * `max-h-24` about three teams — and the arrow handlers only move an index.
 * Without this, `↓ ↓ Invio` confirms a row that scrolled past the fold: §5 makes
 * Enter act on the highlighted row, so the flow buys a player the reader cannot
 * see. It is the same failure as a highlight resting on an unselectable row,
 * one layer down.
 *
 * `block: 'nearest'` so a row already visible does not jerk the list, and no
 * `behavior: 'smooth'`: document 2 §2 closes its list of movements with
 * "nient'altro si anima", and a smooth scroll is driven by the same frame loop
 * that stops when the window is occluded.
 */
function useScrollIntoView<T extends HTMLElement>(highlight: number): React.RefObject<T> {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  return ref
}

/**
 * The next row Enter may land on, skipping the ones somebody already owns.
 *
 * Skipping rather than stopping on them: §7 says an owned player is "non
 * selezionabile", and a highlight that could rest there would make Enter do
 * nothing on a row that looks chosen — the worst possible answer during the one
 * interaction that has to work without being watched. The row still shows who
 * has him and for how much; it just is not a destination.
 *
 * Returns the starting point unchanged when nothing is selectable, so a search
 * whose every hit is already sold leaves the highlight where it was instead of
 * looping.
 */
function nextSelectable(
  results: readonly PlayerRow[],
  from: number,
  step: 1 | -1,
  ok: (p: PlayerRow) => boolean,
): number {
  if (results.length === 0) return 0
  for (let n = 1; n <= results.length; n += 1) {
    const at = (from + step * n + results.length * n) % results.length
    if (ok(results[at])) return at
  }
  return from
}

function Results({
  results,
  matched,
  highlight,
  owners,
  onPick,
}: {
  results: readonly PlayerRow[]
  matched: number
  highlight: number
  owners: Map<number, { team: string; price: number }>
  onPick: (p: PlayerRow) => void
}): JSX.Element {
  const chosenRow = useScrollIntoView<HTMLDivElement>(highlight)

  if (results.length === 0) {
    return <p className="px-1 py-2 text-sm text-chalk-dim">{notices.NO_SEARCH_RESULTS()}</p>
  }

  return (
    <ul className="max-h-44 shrink-0 overflow-auto rounded-md border border-line">
      {results.map((p, i) => {
        const owner = owners.get(p.id)
        return (
          <li key={p.id}>
            <div
              ref={i === highlight ? chosenRow : undefined}
              role="button"
              tabIndex={-1}
              aria-disabled={owner !== undefined}
              className={`flex items-baseline gap-2 px-2 py-1 text-sm ${
                i === highlight ? 'bg-pitch-700' : ''
              } ${owner ? 'opacity-45' : ''}`}
              onClick={() => {
                if (!owner) onPick(p)
              }}
            >
              <span className="min-w-0 flex-1 truncate text-chalk">{p.name}</span>
              <span className="label shrink-0 text-xs text-chalk-dim">
                {p.roleClassic} {p.teamCode ?? p.teamName}
              </span>
              <span className="figures w-8 shrink-0 text-right text-xs text-credit">
                {p.qtClassicCurrent ?? '—'}
              </span>
            </div>
            {owner && (
              <p className="px-2 pb-1 text-xs text-taken">
                {errorMessages.PLAYER_ALREADY_OWNED({ team: owner.team, price: owner.price })}
              </p>
            )}
          </li>
        )
      })}
      {matched > results.length && (
        <li className="px-2 py-1 text-xs text-chalk-dim">
          {matched - results.length === 1
            ? 'un altro giocatore: scrivi qualche lettera in più'
            : `altri ${matched - results.length}: scrivi qualche lettera in più`}
        </li>
      )}
    </ul>
  )
}
