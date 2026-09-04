import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import Figure from '@/components/Figure'
import PriceField from '@/components/PriceField'
import { haystack, search as fuzzy } from '@/features/players/search'
import {
  CLASSIC_ROLES,
  normalizeName,
  planCells,
  planTotals,
  ROLE_LABELS,
  ROLE_LABELS_ONE,
  type ClassicRole,
  spelledOut,
} from '@shared/domain'
import { errorMessages, notices } from '@shared/errors'
import type { LeagueDetail, PlanDetail, PlayerRow } from '@shared/types'

/**
 * Piani, document 2 §4.7: "griglia degli slot della rosa, uno per casella,
 * divisi per ruolo".
 *
 * A plan is a hypothesis about prices, so the number that matters is not what it
 * costs but what is left per empty slot — "la media disponibile per slot
 * rimanente, che è il numero che dice se il piano regge". It sits in the bar,
 * beside spent and remaining, and it is `null` on a full roster rather than
 * zero: the same guard invariant 5 puts on the maximum bid.
 *
 * Two plans can be shown side by side, which is why the grid is a component and
 * the page holds two ids rather than one.
 */

export default function PlansView(): JSX.Element {
  const params = useParams()
  const id = window.Number(params.id)
  const queryClient = useQueryClient()

  const league = useQuery({
    queryKey: ['league.get', id],
    queryFn: () => call('league.get', { id }),
    enabled: Number.isInteger(id),
  })
  const plans = useQuery({
    queryKey: ['plan.list', id],
    queryFn: () => call('plan.list', { leagueId: id }),
    enabled: Number.isInteger(id),
  })

  const [openId, setOpenId] = useState<number | null>(null)
  const [compareId, setCompareId] = useState<number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [resync, setResync] = useState(0)
  const [name, setName] = useState('')

  /** Risponde se la scrittura e' andata a buon fine: chi svuota un campo dopo
   *  averla chiamata deve svuotarlo solo allora. Un `.then()` su una promessa che
   *  risolve comunque cancella il nome che l'utente ha appena scritto, insieme
   *  al messaggio che gli spiegava cosa correggere. */
  function guard(run: () => Promise<PlanDetail[]>) {
    return async (): Promise<boolean> => {
      setRefusal(null)
      try {
        queryClient.setQueryData(['plan.list', id], await run())
        return true
      } catch (e) {
        setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
        setResync((n) => n + 1)
        return false
      }
    }
  }

  if (league.isPending || plans.isPending) return <Frame>{null}</Frame>

  if (league.isError || plans.isError) {
    const error = league.error ?? plans.error
    return (
      <Frame>
        <p className="text-base text-blocking">
          {error instanceof IpcError ? error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Frame>
    )
  }

  if (league.data === null) {
    return (
      <Frame>
        <p className="text-base text-fg-muted">{errorMessages.LEAGUE_MISSING()}</p>
      </Frame>
    )
  }

  // Estratta dopo i controlli: dentro una callback JSX `league.data` torna a essere
  // nullable, perché è la proprietà di un oggetto che TypeScript non può assumere
  // immutabile fra un render e l'altro.
  const openLeague = league.data
  const all = plans.data
  // The one being looked at, falling back to the first: a selector showing a plan
  // whose grid is not the one below it is a picker disagreeing with itself.
  const open = all.find((p) => p.id === openId) ?? all[0] ?? null
  const compare = compareId === null ? null : (all.find((p) => p.id === compareId) ?? null)

  return (
    <Frame>
      <h1 className="font-display text-heading font-medium">Piani</h1>
      <p className="mt-1 text-base text-fg-muted">
        {openLeague.name} · budget <Figure value={openLeague.budget} kind="money" />
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-base">
          <span className="label text-micro block text-fg-muted">nuovo piano</span>
          <input
            className="mt-1 w-48 rounded-md border border-line bg-surface px-2 py-1 text-base"
            placeholder="Difesa forte"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() !== '') {
                void guard(() => call('plan.create', { leagueId: id, name }))().then(
                  (done) => done && setName(''),
                )
              }
            }}
          />
        </label>
        <button
          className="rounded-md bg-surface-raised px-3 py-1.5 text-base hover:bg-line disabled:opacity-40"
          disabled={name.trim() === ''}
          onClick={() =>
            void guard(() => call('plan.create', { leagueId: id, name }))().then(
              (done) => done && setName(''),
            )
          }
        >
          Crea
        </button>

        {all.length > 0 && (
          <label className="text-base">
            <span className="label text-micro block text-fg-muted">piano</span>
            <select
              className="mt-1 rounded-md border border-line bg-surface px-2 py-1 text-base"
              value={open?.id ?? ''}
              onChange={(e) => setOpenId(window.Number(e.target.value))}
            >
              {all.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* "Due piani si possono affiancare per confronto": the second one is a
            choice and not a mode, so it lists only the plans that are not open. */}
        {all.length > 1 && (
          <label className="text-base">
            <span className="label text-micro block text-fg-muted">confronta con</span>
            <select
              className="mt-1 rounded-md border border-line bg-surface px-2 py-1 text-base"
              value={compare?.id ?? ''}
              onChange={(e) =>
                setCompareId(e.target.value === '' ? null : window.Number(e.target.value))
              }
            >
              <option value="">nessuno</option>
              {all
                .filter((p) => p.id !== open?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      {refusal && <p className="mt-3 text-base text-blocking">{refusal}</p>}

      {all.length === 0 ? (
        // Document 2 §8, word for word. Unlike the objectives, this one invites an
        // action that lives right here: the field above it.
        <p className="mt-8 text-base text-fg-muted">
          Nessun piano. Costruisci una rosa ipotetica per capire quanto ti serve per reparto.
        </p>
      ) : (
        <div className={`mt-6 grid gap-6 ${compare ? 'grid-cols-2' : ''}`}>
          {/* Due colonne senza breakpoint, e non `lg:grid-cols-2`.
              La ragione storica è caduta e la scelta resta giusta: la finestra
              si apriva a 900px e `lg` parte da 1024, quindi col breakpoint il
              confronto che il §4.7 chiede non sarebbe comparso mai — è il
              difetto che T12 ha preso. T24 ha portato la finestra a 1440×900
              con un minimo di 1100, quindi oggi `lg` si applicherebbe. Non si
              rimette lo stesso: il confronto lo si chiede scegliendo un secondo
              piano, chi lo chiede lo vuole vedere, e legarlo a una larghezza
              vorrebbe dire nasconderlo a chi stringe la finestra. */}
          {[open, compare].filter((p): p is PlanDetail => p !== null).map((plan) => (
            <Grid
              key={`${plan.id}-${resync}`}
              plan={plan}
              league={openLeague}
              onAdd={(playerId, estPrice) =>
                void guard(() => call('plan.addItem', { planId: plan.id, playerId, estPrice }))()
              }
              onPrice={(playerId, estPrice) =>
                void guard(() => call('plan.updateItem', { planId: plan.id, playerId, estPrice }))()
              }
              onRemove={(playerId) =>
                void guard(() => call('plan.removeItem', { planId: plan.id, playerId }))()
              }
              onDelete={() => {
                void guard(() => call('plan.delete', { id: plan.id }))()
                if (openId === plan.id) setOpenId(null)
                if (compareId === plan.id) setCompareId(null)
              }}
            />
          ))}
        </div>
      )}
    </Frame>
  )
}

function Grid({
  plan,
  league,
  onAdd,
  onPrice,
  onRemove,
  onDelete,
}: {
  plan: PlanDetail
  league: LeagueDetail
  onAdd: (playerId: number, estPrice: number) => void
  onPrice: (playerId: number, estPrice: number) => void
  onRemove: (playerId: number) => void
  onDelete: () => void
}): JSX.Element {
  const totals = planTotals(plan.items, league.slots, league.budget)
  const cells = planCells(plan.items, league.slots)
  /** Which empty cell has the picker open: one at a time, by role. */
  const [picking, setPicking] = useState<ClassicRole | null>(null)

  return (
    <section className="min-w-0 rounded-md border border-line bg-surface-panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-title font-medium">{plan.name}</h2>
        <button
          className="text-base text-fg-muted hover:text-blocking"
          onClick={onDelete}
          aria-label="cancella il piano"
        >
          cancella
        </button>
      </div>

      {/* La barra del §4.7. La media è l'ultima e la più grande delle tre: è il
          numero per cui il piano esiste. */}
      <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-line pb-3">
        <div>
          <dt className="label inline text-micro text-fg-muted">speso </dt>
          <dd className="inline text-base">
            <Figure value={totals.spent} kind="money" />
          </dd>
        </div>
        <div>
          <dt className="label inline text-micro text-fg-muted">residuo </dt>
          <dd className="inline text-base">
            <Figure value={totals.remaining} kind="money" />
          </dd>
        </div>
        <div>
          <dt className="label inline text-micro text-fg-muted">
            media per slot rimanente{' '}
          </dt>
          {/* `decimal` and not `money`: this is a division, and the tenth is
              what it has to say. The line it replaces formatted here instead of
              going through the shared formatter — `toLocaleString` with
              `maximumFractionDigits: 1` and no minimum — and the two disagree
              precisely on a result that comes out whole: an exact 20 printed as
              «20», where `decimal` prints «20,0». With the defaults the app
              creates a league with, 500 crediti over 25 slot, an empty plan is
              exactly 20, so the difference showed on the first opening of every
              new plan, on the one number the plan exists for.
              The amber stays because it is still crediti: `kind` picks the
              format, and only `money` brings the colour with it. */}
          <dd className="inline text-base">
            <Figure value={totals.perSlot} kind="decimal" className="text-money" />
          </dd>
        </div>
        <div>
          <dt className="label inline text-micro text-fg-muted">slot </dt>
          {/* Two numbers and a slash, not one figure: `3/25` is read as a single
              fraction, so it stays a string and takes the column role by class. */}
          <dd className="figure-column inline text-base">
            {totals.slotsFilled}/{totals.slotsTotal}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-3">
        {CLASSIC_ROLES.map((role) => (
          <div key={role}>
            {/* Etichetta e peso sulla stessa riga, mentre la board del §4.6 li
                mette su due. Là i ruoli sono colonne e la seconda riga la paga
                una volta; qui sono righe, e quattro righe in più rubano altezza
                proprio alla griglia di caselle per cui la schermata esiste.

                `label` resta sul solo nome del ruolo: il peso 500 è
                dell'etichetta, non delle cifre, che hanno già il loro dalle
                classi di `Figure`.

                Misurata con due piani affiancati, che è il caso stretto, alla
                finestra come si apriva **allora**: 900×620. La colonna stava in
                310px e alla riga ne restavano 276. T24 ha portato la finestra a
                1440×900 con un minimo di 1100, quindi il margine può solo essere
                cresciuto e l'andata a capo degli 835px qui sotto non è più
                raggiungibile stringendo — la misura resta il caso peggiore che
                l'app sappia produrre, ed è per questo che non è stata rifatta. Il peggio plausibile,
                «centrocampisti 500 · 100% del budget», ne occupa 244,5, quindi
                ci sta con 31 di margine; va a capo sotto gli **835px** di
                finestra, misurati stringendo a gradini, e andare a capo non
                rompe niente perché qui non c'è nessun `shrink-0`. Il margine
                dipende da tre cose che non stanno in questo file: la larghezza
                della barra laterale di `AppShell`, il `gap-6` della griglia
                qui sopra e il `p-4` della `section`. Chi ne cambia una
                rimisuri. */}
            <div className="text-base text-fg-muted">
              {/* «portieri 20», senza la parola «crediti»: è la forma che il
                  resoconto del §4.11 dà già a questo stesso dato — la spesa per
                  reparto di `ReportView`, `{ROLE_LABELS[role]} <Figure money>`
                  — e a dire che sono crediti ci pensa l'ambra, che il documento
                  7 §15 non concede a nient'altro.

                  Il sostantivo c'era, ed è stato tolto in revisione. Scritto
                  accanto a una cifra che conta, mente per metà dei suoi 200ms:
                  `useCountUp` arrotonda ogni fotogramma, quindi un reparto che
                  passa da 0 a 1 mostra la cifra ancora a 0 col singolare già
                  scelto sul valore finale — «0 credito», e «1 crediti»
                  togliendolo. Non è un caso di scuola: 40 portieri su 63 hanno
                  qt 1 e il `Picker` qui sotto semina `estPrice` con
                  `Math.round(qt)`, quindi il primo terzo portiere lo produce da
                  sé. Lo stesso inciampo che `ReportView` racconta a riga 295 per
                  «1 spesi», e la casa lo risolve così: via il sostantivo, non
                  via l'animazione, che il §7 elenca fra le sole quattro. */}
              <span className="label text-micro">{ROLE_LABELS[role]}</span>{' '}
              <Figure value={totals.byRole[role].spent} kind="money" />
              {/* La quota manca solo a budget zero, che `contracts.ts` ammette.
                  Un «— del budget» non direbbe niente a nessuno. */}
              {totals.byRole[role].budgetShare !== null && (
                <>
                  {' · '}
                  {/* La quota, non il suo centuplo: `percent` moltiplica per
                      cento da sé, e il commento di `TargetsView` racconta cosa
                      costa farlo a mano. Niente ambra — una percentuale non è
                      denaro, documento 7 §15. */}
                  <Figure value={totals.byRole[role].budgetShare} kind="percent" />
                  {' del budget'}
                </>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {cells[role].filled.map((item) => (
                <Cell
                  key={item.playerId}
                  name={item.name}
                  team={item.teamCode ?? item.teamName}
                  price={item.estPrice}
                  onPrice={(estPrice) => onPrice(item.playerId, estPrice ?? 0)}
                  onRemove={() => onRemove(item.playerId)}
                />
              ))}

              {Array.from({ length: cells[role].empty }, (_, i) => (
                <button
                  key={`empty-${i}`}
                  className="h-12 w-32 rounded-md border border-dashed border-line text-base text-fg-muted hover:border-fg-muted"
                  onClick={() => setPicking(picking === role ? null : role)}
                >
                  + vuoto
                </button>
              ))}

              {/* Chi è oltre gli slot del suo ruolo. Non si nasconde: gli slot si
                  possono abbassare sotto un piano già fatto (invariante 16), e un
                  giocatore che sparisce dalla griglia senza dirlo è peggio di uno
                  segnalato. */}
              {cells[role].overflow.map((item) => (
                <Cell
                  key={item.playerId}
                  name={item.name}
                  team={item.teamCode ?? item.teamName}
                  price={item.estPrice}
                  outside
                  onPrice={(estPrice) => onPrice(item.playerId, estPrice ?? 0)}
                  onRemove={() => onRemove(item.playerId)}
                />
              ))}
            </div>

            {picking === role && (
              <Picker
                seasonId={league.seasonId}
                role={role}
                taken={plan.items.map((item) => item.playerId)}
                onPick={(player) => {
                  onAdd(player.id, Math.round(player.qtClassicCurrent ?? 0))
                  setPicking(null)
                }}
                onClose={() => setPicking(null)}
              />
            )}
          </div>
        ))}
      </div>

      {cells.P.overflow.length +
        cells.D.overflow.length +
        cells.C.overflow.length +
        cells.A.overflow.length >
        0 && (
        <p className="mt-3 text-base text-fg">
          Alcuni giocatori sono oltre gli slot del loro ruolo: gli slot della lega sono stati
          abbassati dopo. Toglili o rialza gli slot.
        </p>
      )}
    </section>
  )
}

function Cell({
  name,
  team,
  price,
  outside = false,
  onPrice,
  onRemove,
}: {
  name: string
  team: string
  price: number
  outside?: boolean
  onPrice: (next: number | null) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div
      className={`flex h-12 w-32 flex-col justify-between rounded-md px-1.5 py-1 ${
        outside ? 'bg-surface-raised text-fg-muted outline outline-blocking' : 'bg-surface-raised'
      }`}
    >
      <div className="flex items-baseline gap-1">
        <span className="min-w-0 flex-1 truncate text-base">
          {name}
        </span>
        <button
          className="text-base text-fg-muted hover:text-blocking"
          aria-label={`togli ${name} dal piano`}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="label text-micro text-fg-muted">{team}</span>
        <PriceField value={price} label={`prezzo stimato di ${name}`} onCommit={onPrice} />
      </div>
    </div>
  )
}

/**
 * How many rows a *typed* search shows. Named rather than a bare `8` in the
 * slice, which is what stood here: of the four searches in this app three cut,
 * the other two of those declare their number (`MAX_RESULTS` in the auction
 * panel, 6 in the review row) and this was the only one nobody could find or
 * argue with. The fourth, the table of §4.4, does not cut at all — it is
 * virtualised, so there is nothing to declare.
 *
 * It caps the search and not the browse. A browse has nothing to protect the
 * reader from — it is the list of a role, and cutting it silently at eight was
 * the whole of the defect this file was opened for: 8 rows out of 187
 * centrocampisti, presented as if that were all of them.
 */
const MAX_RESULTS = 8

/**
 * Keeps the highlighted row inside the box that scrolls.
 *
 * The auction panel carries its twin and explains it for `Invio` landing on a
 * row that scrolled past the fold. Here the reason is bigger by two orders: the
 * browse list is the whole role — 63 portieri, 186 difensori, 187
 * centrocampisti, 88 attaccanti in the 2026-27 listone — so without this the
 * arrows would walk a highlight the reader cannot see almost immediately.
 *
 * `block: 'nearest'` so a row already in view does not jerk the list, and no
 * `behavior: 'smooth'`: document 2 §2 closes its list of movements with
 * "nient'altro si anima", and a smooth scroll rides the same frame loop that
 * stops when the window is occluded.
 */
function useScrollIntoView<T extends HTMLElement>(highlight: number): React.RefObject<T> {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  return ref
}

/**
 * "Le caselle vuote sono cliccabili e aprono la ricerca filtrata sul ruolo
 * giusto" — and it opens here, inside the plan, rather than sending anyone to
 * Giocatori. The grid is the reason the screen exists; a picker that made you
 * leave it would ask you to hold the roster in your head.
 *
 * The same fuzzy search as the players view, on the same cached listone: one
 * query key, one copy, and a search that tolerates a typo the way §4.4 asks.
 */
function Picker({
  seasonId,
  role,
  taken,
  onPick,
  onClose,
}: {
  seasonId: string
  role: ClassicRole
  taken: readonly number[]
  onPick: (player: PlayerRow) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  // La stessa chiave della vista Giocatori — l'oggetto, come lo scrive il
  // documento 3 §3 — o non e' la stessa voce di cache: il selettore riscaricherebbe
  // le seicento righe che sono gia' in memoria, e le due copie invecchierebbero
  // separate.
  const players = useQuery({
    queryKey: ['player.list', { seasonId }],
    queryFn: () => call('player.list', { seasonId }),
  })

  const pool = useMemo(() => {
    const rows = (players.data?.players ?? []).filter(
      (p) => p.roleClassic === role && !p.delisted && !taken.includes(p.id),
    )
    return { rows, index: haystack(rows) }
  }, [players.data, role, taken])

  /**
   * Whether this is a browse, decided by the *same* rule the search uses.
   *
   * Not `query.trim() === ''`, which is the obvious one and is wrong by exactly
   * one character: `search()` returns the whole list when `normalizeName(query)`
   * is empty, and `normalizeName` drops punctuation before trimming. So a lone
   * `.` is non-empty to `trim` and empty to the search — the picker took the
   * search branch, `fuzzy` handed back all 88 attaccanti in listone order,
   * eight of them survived the cut in that order, and under them sat «altri 80:
   * scrivi qualche lettera in più», advising more letters at the one moment the
   * letter typed is what broke the list. Reproduced in the running app before
   * this line existed.
   *
   * Two conditions asking the same question have to ask it with the same words.
   */
  const browsing = normalizeName(query) === ''

  /**
   * The rows, and how many the cut left behind.
   *
   * Two modes, and the first is not the second shortened. With the field empty
   * this is a **browse**: the whole role, dearest first, because a plan is built
   * from the top of the market down — the same default order §4.4 gives
   * Giocatori. With something typed it is a **search**, and there uFuzzy's own
   * ranking is the answer.
   *
   * Sorting by price before the cut, which is what stood here, let the price
   * decide *who exists* instead of in what order they appear. Measured on the
   * 2026-27 listone that is not a hypothetical: `ma` matches ten attaccanti and
   * the price sort dropped two of them, Lisman and De Martis at qt 1, before
   * anyone could see them — a search that cannot find a player it plainly
   * matches. The auction panel already cuts in the right order
   * (`matches.slice(0, MAX_RESULTS)`).
   *
   * `matched` is the count *before* the cut, so the line under the list and the
   * list itself are two readings of one answer. A browse never cuts, so it
   * reports no remainder and the line stays away.
   */
  const { rows, matched } = useMemo(() => {
    if (browsing) {
      const all = [...pool.rows].sort(
        (a, b) => (b.qtClassicCurrent ?? 0) - (a.qtClassicCurrent ?? 0),
      )
      return { rows: all, matched: all.length }
    }
    const found = fuzzy(pool.index, query)
    return { rows: found.slice(0, MAX_RESULTS), matched: found.length }
  }, [browsing, pool, query])

  /**
   * Where `Invio` would land.
   *
   * Clamped when read rather than kept right when written: the list shrinks
   * under the highlight at every keystroke, and a stored index that outran it
   * would point past the end for a render. Unlike the auction there is nothing
   * to skip — `pool` already dropped whoever the plan has taken and whoever
   * left the listone, so every row is a destination and the `nextSelectable`
   * this would otherwise mirror has no work to do here.
   *
   * `-1` when the list is empty, and `rows[-1]` is `undefined`: the two places
   * that read it both check.
   */
  const at = Math.min(highlight, rows.length - 1)
  const highlighted = useScrollIntoView<HTMLLIElement>(at)

  return (
    <div className="mt-2 rounded-md border border-line bg-surface p-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-panel px-2 py-1 text-base"
          placeholder={`Cerca un ${ROLE_LABELS_ONE[role]}`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Back to the top at every keystroke: the list under the highlight
            // is a different list now, and keeping the index would point it at
            // a row the reader never chose.
            setHighlight(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClose()
              return
            }
            // Document 2 §6 scopes `↑ ↓ Naviga i risultati` to "ricerca", not to
            // the auction — the column beside it says "asta", "assegnazione",
            // "giocatori" where it means one screen. This is a ricerca, and it
            // handled Escape alone.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight(nextHighlight(at, e.key === 'ArrowDown' ? 1 : -1, rows.length))
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const player = rows[at]
              if (player) onPick(player)
            }
          }}
        />
        <button className="text-base text-fg-muted hover:text-fg" onClick={onClose}>
          chiudi
        </button>
      </div>

      {players.isPending && <p className="mt-2 text-base text-fg-muted">Carico il listone…</p>}

      {players.isError && (
        <p className="mt-2 text-base text-blocking">
          {players.error instanceof IpcError
            ? players.error.message
            : errorMessages.IPC_UNAVAILABLE()}
        </p>
      )}

      {!players.isPending && !players.isError && rows.length === 0 && (
        // Due vuoti diversi, e la riga del documento 2 §7 ne copre uno solo.
        // «Prova con meno lettere» presuppone delle lettere: sfogliando non ce
        // ne sono, e il vuoto vuol dire che il piano ha preso tutto il ruolo.
        //
        // Quel secondo caso era stato dichiarato irraggiungibile, con dentro un
        // massimo di slot che non esiste: `SLOT_COUNT` è `min(0)` senza tetto e
        // `domain.ts` scrive per esteso che una lega con più slot che giocatori
        // è «entirely legal». Serve una lega assurda per arrivarci, non un dato
        // impossibile — e la differenza fra le due cose era un riquadro bianco.
        <p className="mt-2 text-base text-fg-muted">
          {browsing
            ? notices.ROLE_EXHAUSTED({ role: ROLE_LABELS_ONE[role] })
            : notices.NO_SEARCH_RESULTS()}
        </p>
      )}

      {/*
        Il contenitore che scorre, e la ragione per cui questa schermata è stata
        riaperta. `max-h-48` sono 192px — i `rem` si radicano sul `font-size` di
        `html`, che resta 16px perché `base.css` porta a 13 il solo `body` — e la
        riga è di 22,2px esatti — misurati con `getBoundingClientRect()` nell'app in
        esecuzione, passo uniforme su otto righe, non sommati a mente; che poi
        coincidano con l'interlinea 1,4 del `text-base` da 13px più i 4 del
        `py-0.5` qui sotto dice solo da cosa dipendono. Fanno 8,65 righe, ed è una
        taglia scelta e non trovata: una ricerca scritta ne produce al massimo 8
        e quindi non scorre mai né viene tagliata, mentre una sfogliata mostra la
        nona a metà, che è il modo in cui una lista dice di continuare. Chi tocca
        `py-0.5`, il `text-base` o la sua interlinea rimisuri.

        `overscroll-contain` perché sotto c'è un'altra cosa che scorre — `Frame`,
        e dietro di lui `main` — e questa lista è l'unica dell'applicazione
        annidata dentro uno scroller di pagina. La proprietà dice cosa
        *impedisce*, non cosa è stato visto: che un gesto arrivato in fondo a
        187 righe prosegua sul documento sotto. Scritto come impedimento e non
        come misura, perché una rotella non si emette con un evento sintetico —
        Chromium scarta lo scorrimento da eventi non fidati — e quindi la
        conseguenza non l'ho riprodotta.
      */}
      <ul className="mt-1 max-h-48 overflow-auto overscroll-contain">
        {rows.map((player, i) => (
          <li key={player.id} ref={i === at ? highlighted : undefined}>
            <button
              className={`flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left text-base hover:bg-surface-raised ${
                i === at ? 'bg-surface-raised' : ''
              }`}
              onClick={() => onPick(player)}
            >
              {/* Same reason as the auction panel: this list searches both names
                  now, so a row that answered `lauta` has to say why. */}
              <span
                className="min-w-0 flex-1 truncate"
              >
                {player.name}
                {spelledOut(player.name, player.fullName) !== null && (
                  <span className="pl-1.5 text-fg-muted">
                    · {spelledOut(player.name, player.fullName)}
                  </span>
                )}
              </span>
              <span className="label text-micro text-fg-muted">{player.teamCode ?? player.teamName}</span>
              {/* The dash for a missing quotazione is `Figure`'s own now: `value`
                  takes null, so the `?? '—'` that used to stand here is gone. */}
              <Figure value={player.qtClassicCurrent} kind="money" />
            </button>
          </li>
        ))}
      </ul>

      {/*
        Quante corrispondenze il taglio ha lasciato fuori. Fuori dall'`ul`, e non
        come ultima riga dentro com'è nel pannello d'asta: là il riquadro alto
        `max-h-44` ne mostra sei di otto, quindi l'avviso che esiste per dire che
        c'è dell'altro sta esso stesso sotto la piega e va scoperto scorrendo.
        Qui è sempre visibile, che è tutto il suo mestiere.
      */}
      {matched > rows.length && (
        <p className="mt-1 px-1 text-sm text-fg-muted">
          {notices.MORE_RESULTS({ n: matched - rows.length })}
        </p>
      )}
    </div>
  )
}

/**
 * Dove va il fuoco virtuale premendo `↑` o `↓`.
 *
 * `from` è la riga corrente (`-1` a lista vuota), `delta` vale `1` o `-1`, e
 * `count` è quante righe ci sono — fino a 187, perché a campo vuoto la lista è
 * il ruolo intero.
 *
 * Trattiene ai bordi: `↓` sull'ultima riga resta sull'ultima, `↑` sulla prima
 * resta sulla prima. È la scelta onesta delle due — la lista finisce davvero, e
 * un ciclo silenzioso dentro 187 righe farebbe saltare la riga evidenziata da un
 * capo all'altro senza che niente lo annunci, che in una lista lunga si legge
 * come «ho perso il segno» e non come «sono tornato in cima».
 *
 * Il prezzo è che dal fondo del ruolo non si risale con un tasto. Sfogliando i
 * 187 centrocampisti quello non è il gesto: si scrivono due lettere, e la lista
 * torna corta.
 *
 * Regge `count === 0`, che il bacino vuoto produrrebbe: torna `0`, e chi legge
 * lo riporta a `-1` col suo `Math.min`, quindi mai `NaN`.
 */
function nextHighlight(from: number, delta: number, count: number): number {
  return Math.max(0, Math.min(from + delta, count - 1))
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="min-w-0 flex-1 overflow-auto p-6">{children}</div>
}
