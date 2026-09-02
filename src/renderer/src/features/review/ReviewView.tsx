import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import { useAuctionStore } from '@/stores/auction'
import { useLeagueStore } from '@/stores/league'
import { haystack } from '@/features/players/search'
import AssignPanel, { type AssignInput } from '@/features/auction/AssignPanel'
import { CLASSIC_ROLES, normalizeName, rosterAnomalies, type ClassicRole } from '@shared/domain'
import { anomalies, anomalyMessage, errorMessages, notices, purchases } from '@shared/errors'
import type { AuctionState } from '@shared/types'
import Controls, { type Focus } from './Controls'
import Row, { type Line, type Patch } from './Row'

/**
 * Revisione, documento 2 §4.10.
 *
 * «Va progettata con la logica opposta a quella dell'asta: lì contava la
 * velocità, qui conta poter mettere le mani ovunque.» Da cui tutto il resto:
 * niente scorciatoie, niente fuoco che salta da un campo all'altro, ogni cella
 * modificabile con un click, e le anomalie che si vedono tutte insieme senza
 * impedire niente — l'invariante 11.
 *
 * Una query sola, come l'asta: `auction.state` porta le rose, i crediti e gli
 * slot, e ogni scrittura risponde con lo stato intero, che va nella cache al
 * posto di invalidarla.
 *
 * **Nessun virtualizzatore.** Duecento righe — dieci squadre per venticinque
 * slot — stanno nel DOM senza che nessuno se ne accorga, e la riga fantasma che
 * `@tanstack/react-virtual` mette in cima è già costata tempo altrove. La vista
 * Giocatori ne ha cinquecentoventiquattro e un altro motivo per averlo.
 */
export default function ReviewView(): JSX.Element {
  const params = useParams()
  const id = window.Number(params.id)
  const setActive = useLeagueStore((s) => s.setActiveLeague)

  const state = useQuery({
    queryKey: ['auction.state', id],
    queryFn: () => call('auction.state', { leagueId: id }),
    enabled: Number.isInteger(id),
  })

  useEffect(() => {
    if (Number.isInteger(id)) setActive(id)
  }, [id, setActive])

  if (state.isPending) return <Frame>{null}</Frame>

  if (state.isError) {
    return (
      <Frame>
        <p className="text-sm text-taken">
          {state.error instanceof IpcError ? state.error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Frame>
    )
  }

  if (state.data === null) {
    return (
      <Frame>
        <p className="text-sm text-chalk-dim">{errorMessages.LEAGUE_MISSING()}</p>
      </Frame>
    )
  }

  if (state.data.league.status !== 'review') return <NotYet state={state.data} />

  return <Table state={state.data} />
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-full flex-col p-4">{children}</div>
}

/**
 * La revisione esiste solo fra la chiusura dell'asta e la cristallizzazione.
 *
 * Dice dove si è invece di mostrare una tabella vuota: prima dell'asta non c'è
 * niente da correggere, dopo la cristallizzazione la lega è di sola lettura e la
 * frase è quella dell'invariante 13, la stessa che rifiuterebbe la scrittura.
 */
function NotYet({ state }: { state: AuctionState }): JSX.Element {
  return (
    <Frame>
      <p className="pb-1 text-sm text-chalk-dim">{state.league.name} · revisione</p>
      <p className="max-w-xl pt-2 text-sm text-chalk-dim">
        {state.league.status === 'closed'
          ? notices.CRYSTALLISED()
          : state.league.status === 'auction'
            ? 'L’asta è ancora aperta. La revisione si apre chiudendola.'
            : 'La revisione arriva dopo l’asta: qui si correggono gli acquisti registrati.'}
      </p>
    </Frame>
  )
}

const TUTTE = 'tutte'
const TUTTI = 'tutti'

function Table({ state }: { state: AuctionState }): JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const openDraft = useAuctionStore((s) => s.open)

  const players = useQuery({
    queryKey: ['player.list', { seasonId: state.league.seasonId }],
    queryFn: () => call('player.list', { seasonId: state.league.seasonId }),
  })

  const [refusal, setRefusal] = useState<string | null>(null)
  const [addRefusal, setAddRefusal] = useState<string | null>(null)
  /**
   * Cambia a ogni rifiuto e rimonta il corpo della tabella.
   *
   * Una cella tiene il testo digitato e lo consegna al blur: quando la scrittura
   * viene rifiutata, dall'alto torna il valore di prima, React non vede niente
   * da cambiare, e il campo resta a mostrare la cifra che il messaggio d'errore
   * ha appena respinto. Il rimontaggio è il modo più corto per farlo tornare
   * d'accordo con il database.
   */
  const [refusalToken, setRefusalToken] = useState(0)

  const [team, setTeam] = useState<number | typeof TUTTE>(TUTTE)
  const [role, setRole] = useState<ClassicRole | typeof TUTTI>(TUTTI)
  const [query, setQuery] = useState('')

  // Butta via una bozza digitata per l'asta di un'altra lega, come fa la vista
  // d'asta: il pannello qui sotto legge lo stesso store.
  useEffect(() => openDraft(state.league.id), [openDraft, state.league.id])

  const index = useMemo(() => haystack(players.data?.players ?? []), [players.data])

  /**
   * «Tabella unica di tutti gli acquisti»: le rose delle squadre, riaperte in
   * una lista sola e rimesse nell'ordine in cui sono state registrate. È
   * l'ordine della serata, ed è quello con cui si va a cercare l'errore — «il
   * terzo o quarto giocatore, quando ancora non avevamo il ritmo».
   */
  const lines = useMemo<Line[]>(
    () =>
      state.teams
        .flatMap((t) => t.roster.map((r) => ({ ...r, teamId: t.id })))
        .sort((a, b) => a.sequence - b.sequence),
    [state.teams],
  )

  const shown = useMemo(() => {
    const needle = normalizeName(query)
    return lines.filter(
      (l) =>
        (team === TUTTE || l.teamId === team) &&
        (role === TUTTI || l.slotRole === role) &&
        (needle === '' || normalizeName(l.name).includes(needle)),
    )
  }, [lines, team, role, query])

  /**
   * Chi ha già chi, costruita una volta per tutte le righe.
   *
   * La stessa mappa che il pannello d'asta ricava da `state.teams`: ogni
   * scrittura risponde con la board intera, quindi il dato è già qui e non serve
   * chiederlo al main. Duecento righe che se la costruissero da sole sarebbero
   * duecento passate sulle rose a ogni battuta.
   */
  const owners = useMemo(() => {
    const map = new Map<number, { team: string; price: number }>()
    for (const t of state.teams) {
      for (const bought of t.roster) map.set(bought.playerId, { team: t.name, price: bought.price })
    }
    return map
  }, [state.teams])

  /**
   * Le anomalie in fila, squadra per squadra.
   *
   * Una lista sola per due lettori: il conteggio dell'intestazione e la conferma
   * della cristallizzazione, che secondo il §4.10 «chiede conferma elencandole».
   * Il pannello a destra le raggruppa per conto suo — lì servono i gruppi, qui
   * l'elenco — ma la funzione che le calcola è la stessa, e un secondo conteggio
   * scritto a parte è il modo in cui l'intestazione direbbe quattro e la
   * conferma ne elencherebbe tre.
   */
  const anomalyLines = useMemo(
    () =>
      state.teams.flatMap((t) =>
        rosterAnomalies(
          { credits: t.credits, filled: t.filled, slots: state.slots },
          state.league.minBid,
        ).map((a) => `${t.name} · ${anomalyMessage(a)}`),
      ),
    [state.teams, state.slots, state.league.minBid],
  )
  const anomalyCount = anomalyLines.length

  function absorb(next: AuctionState): void {
    queryClient.setQueryData(['auction.state', state.league.id], next)
    void queryClient.invalidateQueries({ queryKey: ['league.list'] })
    void queryClient.invalidateQueries({ queryKey: ['auction.history', state.league.id] })
  }

  async function update(purchaseId: number, patch: Patch): Promise<void> {
    setRefusal(null)
    try {
      absorb(await call('purchase.update', { leagueId: state.league.id, purchaseId, ...patch }))
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
      setRefusalToken((n) => n + 1)
    }
  }

  async function remove(purchaseId: number): Promise<void> {
    setRefusal(null)
    try {
      absorb(await call('purchase.delete', { leagueId: state.league.id, purchaseId }))
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
      setRefusalToken((n) => n + 1)
    }
  }

  async function add(input: AssignInput): Promise<boolean> {
    setAddRefusal(null)
    try {
      absorb(await call('auction.assign', { leagueId: state.league.id, ...input }))
      return true
    } catch (e) {
      setAddRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
      return false
    }
  }

  /**
   * «Se ci sono anomalie il bottone chiede conferma elencandole, ma non le
   * impone. Chi gioca sa se una rosa da 24 è un errore o un accordo tra
   * amici.» §4.10.
   *
   * Quindi la conferma compare **solo** quando c'è qualcosa da elencare: senza
   * anomalie non c'è niente da mostrare, e una domanda a vuoto sarebbe la
   * finestra di conferma che il §1 non vuole. E cristallizzare non è
   * irreversibile: «Riapri per modifiche» esiste, e la versione precedente
   * resta.
   */
  const [confirming, setConfirming] = useState(false)

  /**
   * La conferma è aperta **e** c'è ancora qualcosa da confermare.
   *
   * Una derivata e non uno stato, perché la tabella resta modificabile mentre la
   * striscia è aperta — non è una modale, il §1 non le vuole — e correggere
   * l'ultima anomalia da lì lasciava la conferma a chiedere ragione di niente:
   * «nessuna anomalia aperte:» sopra un elenco vuoto. Con la derivata quello
   * stato non è rappresentabile.
   */
  const asking = confirming && anomalyCount > 0

  async function crystallise(): Promise<void> {
    if (anomalyCount > 0 && !asking) {
      setConfirming(true)
      return
    }
    setRefusal(null)
    try {
      const made = await call('snapshot.create', { leagueId: state.league.id })
      await queryClient.invalidateQueries()
      navigate(`/lega/${state.league.id}/resoconto`)
      return void made
    } catch (e) {
      setConfirming(false)
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    }
  }

  function focus(f: Focus): void {
    setTeam(f.teamId)
    setRole(f.role ?? TUTTI)
    setQuery('')
  }

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex items-baseline gap-3 border-b border-line px-4 py-2">
        <h1 className="min-w-0 truncate text-sm">
          {state.league.name} <span className="text-chalk-dim">· revisione</span>
        </h1>
        <span className="ml-auto shrink-0 text-sm text-chalk-dim">
          {purchases(lines.length)} · {anomalies(anomalyCount)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
            <select
              className="rounded-md border border-line bg-pitch-800 px-2 py-1 text-sm"
              value={team}
              onChange={(e) =>
                setTeam(e.target.value === TUTTE ? TUTTE : window.Number(e.target.value))
              }
            >
              <option value={TUTTE}>Tutte le squadre</option>
              {state.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              className="rounded-md border border-line bg-pitch-800 px-2 py-1 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as ClassicRole | typeof TUTTI)}
            >
              <option value={TUTTI}>Tutti i ruoli</option>
              {CLASSIC_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-pitch-800 px-2 py-1 text-sm"
              placeholder="Cerca un giocatore fra gli acquisti"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {refusal !== null && (
            <p className="border-b border-line px-4 py-1.5 text-sm text-taken">{refusal}</p>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {lines.length === 0 ? (
              <p className="px-4 py-4 text-sm text-chalk-dim">
                Nessun acquisto registrato. Aggiungine uno qui sotto.
              </p>
            ) : (
              <table className="w-full border-collapse">
                {/*
                  `w-full` sulla sola colonna del giocatore: in una tabella
                  automatica è così che una colonna si prende tutto lo spazio che
                  le altre non usano, e il nome è la colonna che conta.
                  Misurato nell'app in esecuzione, alla finestra come si apre —
                  900×620, con la barra laterale dell'applicazione e il pannello
                  controlli già tolti: la sezione della tabella è 468px, le altre
                  cinque colonne ne occupano 295 (26 + 40 + 120 + 72 + 37) e al
                  nome ne restano 172. La versione precedente, con `px-3` ovunque
                  e nessun `w-full`, gliene dava 96 — meno che alla colonna del
                  ruolo più quella del prezzo insieme — e nessuna rilettura del
                  codice se n'era accorta.

                  `ruo` come nella vista Giocatori: un troncamento minuscolo,
                  non un acronimo. `squadra` per esteso perché quella colonna è
                  larga per il selettore comunque, e abbreviare non le farebbe
                  guadagnare un pixel.
                */}
                <thead className="sticky top-0 z-10 bg-pitch-900">
                  <tr>
                    <th className="label border-b border-line px-2 py-2 text-right text-chalk-dim">
                      #
                    </th>
                    <th className="label w-full border-b border-line px-2 py-2 text-left text-chalk-dim">
                      giocatore
                    </th>
                    <th className="label border-b border-line px-2 py-2 text-left text-chalk-dim">
                      ruo
                    </th>
                    <th className="label border-b border-line px-2 py-2 text-left text-chalk-dim">
                      squadra
                    </th>
                    <th className="label border-b border-line px-2 py-2 text-right text-chalk-dim">
                      prezzo
                    </th>
                    <th className="border-b border-line" />
                  </tr>
                </thead>
                <tbody key={refusalToken}>
                  {shown.map((line) => (
                    <Row
                      key={line.purchaseId}
                      line={line}
                      teams={state.teams}
                      index={index}
                      owners={owners}
                      onUpdate={(patch) => void update(line.purchaseId, patch)}
                      onDelete={() => void remove(line.purchaseId)}
                    />
                  ))}
                </tbody>
              </table>
            )}

            {lines.length > 0 && shown.length === 0 && (
              <p className="px-4 py-4 text-sm text-chalk-dim">
                Nessun acquisto con questi filtri. Togline uno per allargare la ricerca.
              </p>
            )}
          </div>

          {/* «+ Aggiungi un acquisto in fondo, per le righe dimenticate durante
              l'asta. Stesso flusso di inserimento della schermata d'asta, senza
              fretta.» Alla lettera: è quel pannello, non una sua copia. */}
          <div className="border-t border-line">
            <AssignPanel
              state={state}
              players={players.data?.players ?? []}
              playersError={players.isError ? errorMessages.IPC_UNAVAILABLE() : null}
              refusal={addRefusal}
              focusToken={0}
              onEdit={() => setAddRefusal(null)}
              onAssign={add}
            />
          </div>

          {/* Il piede del disegno del §4.10, sotto «Aggiungi un acquisto». */}
          <div className="border-t border-line px-4 py-2">
            {asking && (
              <div className="pb-2">
                <p className="pb-1 text-sm text-chalk-dim">
                  {notices.ANOMALIES_OPEN({ n: anomalyCount })}
                </p>
                <ul className="max-h-24 overflow-y-auto text-sm text-taken">
                  {anomalyLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-3">
              {asking && (
                // «Annulla» e non «Torna a sistemarle»: con una sola anomalia il
                // clitico plurale mente, ed è l'etichetta che la conferma di
                // chiusura asta usa già per il suo secondo bottone.
                <button
                  className="rounded-md border border-line px-3 py-1 text-sm text-chalk-dim hover:text-chalk"
                  onClick={() => setConfirming(false)}
                >
                  Annulla
                </button>
              )}
              <button
                className="mx-auto rounded-md border border-line bg-pitch-700 px-4 py-1.5 text-sm"
                onClick={() => void crystallise()}
              >
                {asking ? 'Cristallizza lo stesso' : 'Cristallizza il resoconto'}
              </button>
            </div>
          </div>
        </section>

        <Controls state={state} onFocus={focus} />
      </div>
    </div>
  )
}
