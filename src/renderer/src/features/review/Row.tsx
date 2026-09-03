import { useMemo, useState } from 'react'
import { haystack, search as fuzzy } from '@/features/players/search'
import { spelledOut } from '@shared/domain'
import { errorMessages, notices } from '@shared/errors'
import type { AuctionState } from '@shared/types'

/**
 * Una riga della tabella di revisione, documento 2 §4.10: «prezzo e squadra
 * modificabili in linea: click sulla cella, digiti, Tab. Il giocatore si
 * sostituisce aprendo la ricerca dalla cella. Ogni riga ha un menu per
 * eliminarla.»
 *
 * Le tre celle scrivono tutte attraverso lo stesso canale — `purchase.update`
 * ne prende tre campi facoltativi — quindi qui non c'è nessuna logica di
 * dominio: solo quale campo sta cambiando. Il ruolo non è modificabile e non è
 * una dimenticanza: lo decide il giocatore, ed è l'invariante 12.
 */

/**
 * Una voce di rosa più la squadra che la possiede.
 *
 * Derivata dal contratto e non riscritta accanto: `shared/types.ts` si apre
 * dicendo che i DTO non si riscrivono, e una copia a mano aveva già perso un
 * tipo — `slotRole` era diventato `string`, proprio il campo che la vista
 * confronta con un filtro tipizzato `ClassicRole`.
 */
export type Line = AuctionState['teams'][number]['roster'][number] & { teamId: number }

export type Patch = { price?: number; fantaTeamId?: number; playerId?: number }

/** Quanti risultati sotto la cella: la stessa misura del pannello d'asta. */
const MAX_RESULTS = 6

export default function Row({
  line,
  teams,
  index,
  owners,
  onUpdate,
  onDelete,
}: {
  line: Line
  teams: AuctionState['teams']
  /** Costruito una volta sola dalla vista: un indice per riga sarebbe duecento. */
  index: ReturnType<typeof haystack>
  /** Chi ha già chi, per la stessa ragione: una mappa sola per tutte le righe. */
  owners: ReadonlyMap<number, { team: string; price: number }>
  onUpdate: (patch: Patch) => void
  onDelete: () => void
}): JSX.Element {
  /**
   * Il prezzo digitato, tenuto qui finché non si consegna.
   *
   * Si consegna al blur e all'Invio, e la riga si rimonta a ogni rifiuto —
   * `key` sul corpo della tabella, nella vista. Senza quel rimontaggio il campo
   * resterebbe a mostrare proprio la cifra che il messaggio d'errore sopra ha
   * appena respinto, perché il valore che torna dall'alto è quello di prima e
   * React non ha niente da cambiare.
   */
  const [draft, setDraft] = useState(String(line.price))
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)

  const results = useMemo(
    () => (query.trim() === '' ? [] : fuzzy(index, query).slice(0, MAX_RESULTS)),
    [index, query],
  )

  /**
   * Chi possiede un giocatore, tranne questa riga stessa.
   *
   * Il §7: «giocatore già acquistato → appare nei risultati ma non
   * selezionabile, riga attenuata». Vale anche qui, e senza questa riga
   * sceglierlo faceva il giro dell'IPC per tornare come `PLAYER_ALREADY_OWNED`
   * in cima alla tabella — un rifiuto giusto detto tre secondi dopo e lontano
   * dal dito.
   *
   * Sé stessa esclusa perché riscrivere un acquisto con il giocatore che ha già
   * non è un doppione: il servizio lo accetta, e vederlo attenuato direbbe che
   * la riga è occupata da qualcun altro.
   */
  const ownerOf = (playerId: number): { team: string; price: number } | null =>
    playerId === line.playerId ? null : (owners.get(playerId) ?? null)

  /** Su cosa cade l'Invio: il primo risultato che si può davvero scegliere. */
  const first = results.find((p) => ownerOf(p.id) === null) ?? null

  function commitPrice(): void {
    const n = window.Number(draft)
    // Non un rifiuto: una cifra che non è una cifra non è mai stata un prezzo.
    // Il campo torna al valore vero invece di mandare al main una richiesta che
    // lo schema rifiuterebbe con «Richiesta non valida».
    if (draft.trim() === '' || !Number.isInteger(n) || n < 0) {
      setDraft(String(line.price))
      return
    }
    if (n !== line.price) onUpdate({ price: n })
  }

  return (
    <tr className="border-b border-line/50 hover:bg-pitch-800">
      <td className="figures px-2 py-1.5 text-right text-sm text-chalk-dim">{line.sequence}</td>

      <td className="relative min-w-0 px-2 py-1.5 text-sm">
        {searching ? (
          <>
            <input
              autoFocus
              className="w-full rounded-md border border-line bg-pitch-900 px-2 py-1 text-sm"
              placeholder="Sostituisci il giocatore"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setSearching(false)
                  setQuery('')
                }
                if (e.key === 'Enter' && first) {
                  onUpdate({ playerId: first.id })
                  setSearching(false)
                  setQuery('')
                }
              }}
            />
            {query.trim() !== '' && (
              <div className="absolute left-2 right-2 z-20 mt-1 overflow-hidden rounded-md border border-line bg-pitch-700 shadow-lg">
                {results.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-chalk-dim">
                    {notices.NO_SEARCH_RESULTS()}
                  </p>
                ) : (
                  <ul>
                    {results.map((p) => {
                      const owner = ownerOf(p.id)
                      return (
                        <li key={p.id}>
                          <button
                            className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-pitch-800 disabled:opacity-40 disabled:hover:bg-transparent"
                            disabled={owner !== null}
                            onClick={() => {
                              onUpdate({ playerId: p.id })
                              setSearching(false)
                              setQuery('')
                            }}
                          >
                            {/* The list you replace a purchase from: knowing
                                which player you are about to take matters more
                                here than anywhere, so the name that matched is
                                shown, as in the auction panel. */}
                            <span
                              className="min-w-0 flex-1 truncate"
                              title={
                                spelledOut(p.name, p.fullName) === null
                                  ? p.name
                                  : `${p.name} · ${spelledOut(p.name, p.fullName)}`
                              }
                            >
                              {p.name}
                              {spelledOut(p.name, p.fullName) !== null && (
                                <span className="pl-1.5 text-chalk-dim">
                                  · {spelledOut(p.name, p.fullName)}
                                </span>
                              )}
                            </span>
                            <span className="label shrink-0 text-xs text-chalk-dim">
                              {owner === null
                                ? `${p.roleClassic} · ${p.teamCode ?? p.teamName}`
                                : errorMessages.PLAYER_ALREADY_OWNED(owner)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <button
            className="flex w-full min-w-0 items-center gap-2 text-left hover:text-chalk"
            onClick={() => setSearching(true)}
          >
            <span className="min-w-0 truncate">{line.name}</span>
            {line.delisted && (
              <span className="label shrink-0 text-xs text-taken" title={notices.DELISTED()}>
                fuori listone
              </span>
            )}
          </button>
        )}
      </td>

      <td className="px-2 py-1.5 text-sm text-chalk-dim">{line.slotRole}</td>

      <td className="px-2 py-1.5 text-sm">
        <select
          /*
            `min-w-[6.5rem]` e non una larghezza sulla colonna: in una tabella a
            layout automatico la `w-28` sul `th` è una preferenza, e la colonna
            del giocatore con `w-full` se la riprende. Il minimo sul selettore no
            — misurato, la colonna passa da 75px a 112 e il nome della squadra si
            legge invece di finire in tre lettere e una freccia.
          */
          className="w-full min-w-[6.5rem] rounded-md border border-line bg-pitch-900 px-1 py-0.5 text-sm"
          value={line.teamId}
          onChange={(e) => onUpdate({ fantaTeamId: window.Number(e.target.value) })}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </td>

      <td className="px-2 py-1.5 text-right">
        <input
          className="figures w-14 rounded-md border border-line bg-pitch-900 px-1 py-0.5 text-right text-sm"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitPrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setDraft(String(line.price))
            }
          }}
        />
      </td>

      {/* Il menu del §4.10, e il menu *è* la cautela: eliminare una riga in
          revisione non ha un annulla — `auction.undo` toglie l'ultimo acquisto
          dell'asta, non una riga qualunque — quindi la protezione è che ci
          vogliano due gesti, non una domanda in mezzo allo schermo. */}
      <td className="relative px-2 py-1.5 text-right">
        <button
          className="px-1 text-chalk-dim hover:text-chalk"
          aria-label="Azioni sulla riga"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
        >
          ⋯
        </button>
        {menu && (
          <div className="absolute right-2 top-8 z-20 rounded-md border border-line bg-pitch-700 shadow-lg">
            <button
              className="whitespace-nowrap px-3 py-1.5 text-sm text-taken hover:bg-pitch-800"
              onClick={() => {
                setMenu(false)
                onDelete()
              }}
            >
              Togli l’acquisto
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
