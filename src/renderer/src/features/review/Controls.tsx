import { useState } from 'react'
import Figure from '@/components/Figure'
import { rosterAnomalies, type ClassicRole, type RosterAnomaly } from '@shared/domain'
import { anomalyMessage } from '@shared/errors'
import type { AuctionState } from '@shared/types'

/**
 * Il pannello controlli del documento 2 §4.10.
 *
 * Le regole sono tre e sono tutte sulla stessa riga del documento: le anomalie
 * sono **raggruppate per squadra**, **tutte vengono mostrate** — «niente "e
 * altre 12", niente troncamento, niente riassunto» — e sono **cliccabili**, e
 * portano alla riga interessata filtrando la tabella su quella squadra.
 *
 * Un gruppo si richiude quando l'hai sistemato. Richiudere è l'unica cosa che
 * toglie righe dallo schermo: niente sparisce perché l'app ha deciso che non
 * contava.
 */

export type Focus = { teamId: number; role: ClassicRole | null }

export default function Controls({
  state,
  onFocus,
}: {
  state: AuctionState
  onFocus: (focus: Focus) => void
}): JSX.Element {
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set())

  const groups = state.teams
    .map((team) => ({
      team,
      anomalies: rosterAnomalies(
        { credits: team.credits, filled: team.filled, slots: state.slots },
        state.league.minBid,
      ),
    }))
    .filter((g) => g.anomalies.length > 0)

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-l border-line bg-pitch-800">
      <h2 className="label sticky top-0 border-b border-line bg-pitch-800 px-3 py-2 text-xs text-chalk-dim">
        Controlli
      </h2>

      {groups.length === 0 ? (
        <p className="px-3 py-3 text-sm text-chalk-dim">Nessuna anomalia: le rose tornano tutte.</p>
      ) : (
        <ul>
          {groups.map(({ team, anomalies }) => {
            const open = !closed.has(team.id)
            return (
              <li key={team.id} className="border-b border-line/60">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-pitch-700"
                  aria-expanded={open}
                  onClick={() =>
                    setClosed((was) => {
                      const next = new Set(was)
                      if (open) next.add(team.id)
                      else next.delete(team.id)
                      return next
                    })
                  }
                >
                  <span aria-hidden className="text-chalk-dim">
                    {open ? '▾' : '▸'}
                  </span>
                  {/* min-w-0 e non shrink-0: senza, un nome lungo tiene la sua
                      larghezza intrinseca e spinge il conteggio fuori dal
                      pannello — la trappola di T14, con `truncate` che non
                      tronca perché nessun antenato costringe la larghezza. */}
                  <span className="min-w-0 flex-1 truncate">{team.name}</span>
                  {/* Quante ne ha quella squadra, non dei crediti: niente
                      ambra e nessun conteggio animato, che il §7 riserva al
                      denaro. Il `text-chalk-dim` è quello di prima, e la
                      taglia la dà la riga. */}
                  <Figure value={anomalies.length} className="text-chalk-dim" />
                </button>

                {open && (
                  <ul className="pb-2">
                    {anomalies.map((anomaly, i) => (
                      <li key={i}>
                        <button
                          className="block w-full px-3 py-0.5 pl-8 text-left text-sm text-chalk-dim hover:text-chalk"
                          onClick={() => onFocus({ teamId: team.id, role: roleOf(anomaly) })}
                        >
                          {anomalyMessage(anomaly)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

/**
 * Quale ruolo filtrare cliccando l'anomalia.
 *
 * «Porta alla riga interessata», e la riga interessata esiste in un caso solo:
 * un ruolo **oltre** il limite ha righe di troppo da guardare, e filtrarlo le
 * isola. Le altre tre no, ognuna per una ragione sua, e per tutte si filtra la
 * sola squadra:
 *
 * - un ruolo **mancante** non ha righe per definizione. Filtrarlo apriva una
 *   tabella vuota con scritto «Nessun acquisto con questi filtri», che sembra un
 *   filtro rotto invece della risposta — provato nell'app, non dedotto;
 * - uno **sforamento** si guarda su tutta la rosa, che è dove sta la cifra di
 *   troppo, e stringere su un ruolo la nasconderebbe;
 * - una rosa **incompletabile** è una questione di crediti come lo sforamento.
 */
function roleOf(anomaly: RosterAnomaly): ClassicRole | null {
  return anomaly.code === 'ROLE_OVER' ? anomaly.role : null
}
