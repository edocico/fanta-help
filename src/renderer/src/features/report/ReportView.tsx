import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import Figure from '@/components/Figure'
import { call, IpcError } from '@/lib/ipc'
import { useLeagueStore } from '@/stores/league'
import { shortHash, when } from '@/lib/format'
import { CLASSIC_ROLES, ROLE_LABELS } from '@shared/domain'
import { errorMessages } from '@shared/errors'
import { snapshotReport, type SnapshotFile } from '@shared/snapshot'
import type { SnapshotDetail, SnapshotSummary } from '@shared/types'

/**
 * Resoconto, documento 2 §4.11: «la lega cristallizzata, in sola lettura».
 *
 * Legge lo snapshot e **non il database**: è la differenza fra un resoconto e
 * una vista. Le rose qui dentro sono quelle di quel momento, con i prezzi di
 * quel momento, anche se nel frattempo la lega è stata riaperta e cambiata —
 * ed è il motivo per cui la barra in cima dice quale versione stai guardando.
 *
 * I due bottoni di export del §4.11 non ci sono: sono T18. Un bottone che non
 * fa niente manda a cercare il guasto dalla parte sbagliata, ed è lo stesso
 * motivo per cui il «Cristallizza» non era in T16.
 */
export default function ReportView(): JSX.Element {
  const params = useParams()
  const id = window.Number(params.id)
  const setActive = useLeagueStore((s) => s.setActiveLeague)
  const [chosen, setChosen] = useState<number | null>(null)

  useEffect(() => {
    if (Number.isInteger(id)) setActive(id)
  }, [id, setActive])

  const versions = useQuery({
    queryKey: ['snapshot.list', id],
    queryFn: () => call('snapshot.list', { leagueId: id }),
    enabled: Number.isInteger(id),
  })

  const detail = useQuery({
    queryKey: ['snapshot.get', id, chosen],
    queryFn: () => call('snapshot.get', { leagueId: id, ...(chosen ? { version: chosen } : {}) }),
    enabled: Number.isInteger(id),
  })

  /**
   * Lo stato della lega, che lo snapshot non porta e non deve portare: il file
   * dice com'era la lega, non com'è adesso.
   *
   * Serve a una cosa sola, ed è «Riapri per modifiche»: una lega già riaperta
   * non si riapre, e il bottone lo direbbe solo dopo, con un rifiuto. La stessa
   * chiave della vista d'asta e della revisione, quindi la risposta è già in
   * cache.
   */
  const league = useQuery({
    queryKey: ['auction.state', id],
    queryFn: () => call('auction.state', { leagueId: id }),
    enabled: Number.isInteger(id),
  })

  /**
   * `league` è nella guardia con le altre due, e non è pignoleria: il piede
   * afferma «la lega è aperta in revisione» quando `crystallised` è falso, e
   * finché quella query non risponde `falso` vuol dire «non lo so ancora». Le
   * tre partono insieme e non hanno un ordine garantito — a cache fredda,
   * entrando dalla barra laterale, il piede diceva il contrario del vero e il
   * bottone «Riapri per modifiche» non compariva.
   */
  if (versions.isPending || detail.isPending || league.isPending) return <Frame>{null}</Frame>

  if (versions.isError || detail.isError) {
    const e = versions.error ?? detail.error
    return (
      <Frame>
        <p className="text-base text-taken">
          {e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Frame>
    )
  }

  /**
   * `snapshot.get` risponde `null` per due domande diverse — «questa lega non ha
   * ancora un resoconto» e «questa lega non esiste più» — e la seconda la
   * distingue solo `league`, che a sua volta risponde `null` esattamente lì.
   *
   * `!league.data` e non `=== null`: la query è disabilitata quando la rotta non
   * porta un numero, e allora il dato non è nullo, è assente. Le due cose qui
   * dicono la stessa cosa a chi guarda — questa lega non c'è.
   */
  if (!league.data) {
    return (
      <Frame>
        <p className="text-base text-chalk-dim">{errorMessages.LEAGUE_MISSING()}</p>
      </Frame>
    )
  }

  /**
   * L'invito va a chi può agire da qui, e nomina il gesto con la parola che sta
   * sul bottone.
   *
   * La voce «Resoconto» è nella barra di ogni lega, quindi questa schermata la
   * vede anche chi non ha ancora aperto l'asta: «si chiude dalla revisione»
   * mandava a cercare un comando che non c'è, e per giunta con il verbo che in
   * quest'app nomina un altro passo irreversibile — «Chiudi l'asta».
   */
  if (detail.data === null) {
    const status = league.data.league.status
    return (
      <Frame>
        <p className="pb-1 text-base text-chalk-dim">
          {league.data.league.name} <span>· resoconto</span>
        </p>
        <p className="max-w-xl pt-2 text-base text-chalk-dim">
          {status === 'review'
            ? 'Non c’è ancora un resoconto: lo crea «Cristallizza il resoconto», in fondo alla revisione.'
            : status === 'auction'
              ? 'L’asta è in corso. Il resoconto arriva dopo, dalla revisione.'
              : 'Il resoconto arriva alla fine: prima l’asta, poi la revisione.'}
        </p>
      </Frame>
    )
  }

  return (
    <Report
      leagueId={id}
      detail={detail.data}
      versions={versions.data}
      crystallised={league.data?.league.status === 'closed'}
      chosen={chosen}
      onChoose={setChosen}
    />
  )
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-full flex-col p-4">{children}</div>
}

function Report({
  leagueId,
  detail,
  versions,
  crystallised,
  chosen,
  onChoose,
}: {
  leagueId: number
  detail: SnapshotDetail
  versions: readonly SnapshotSummary[]
  /** Falso su una lega riaperta: il resoconto resta, la riapertura no. */
  crystallised: boolean
  chosen: number | null
  onChoose: (version: number | null) => void
}): JSX.Element {
  const queryClient = useQueryClient()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const file: SnapshotFile = detail.file
  const report = useMemo(() => snapshotReport(file), [file])
  const byTeam = useMemo(() => {
    const map = new Map<string, SnapshotFile['purchases']>()
    for (const bought of file.purchases) {
      map.set(bought.teamUuid, [...(map.get(bought.teamUuid) ?? []), bought])
    }
    return map
  }, [file])

  const [saved, setSaved] = useState<string | null>(null)

  /**
   * Scarica la versione che si sta guardando.
   *
   * `detail.version` e non l'ultima: chi ha aperto la versione 1 dal selettore
   * si aspetta quella, e scaricare silenziosamente la 3 produrrebbe un file che
   * non corrisponde a quello che ha sullo schermo — con un'impronta diversa, che
   * è precisamente ciò che qualcuno confronterà.
   */
  async function download(kind: 'json' | 'xlsx'): Promise<void> {
    setBusy(true)
    setRefusal(null)
    setSaved(null)
    try {
      const done = await call(kind === 'json' ? 'snapshot.exportJson' : 'snapshot.exportXlsx', {
        leagueId,
        version: detail.version,
      })
      // Null è il dialogo annullato, che non è un errore e non merita una riga.
      if (done) setSaved(done.path)
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    } finally {
      setBusy(false)
    }
  }

  /** Riaprire è l'unica scrittura che l'invariante 13 lascia a lega chiusa. */
  async function reopen(): Promise<void> {
    setBusy(true)
    setRefusal(null)
    try {
      await call('snapshot.reopen', { leagueId })
      await queryClient.invalidateQueries()
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen min-h-0 flex-col">
      {/* «In cima, una barra che dice quale versione stai guardando.» §4.11 */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-base">
        <h1 className="min-w-0 truncate">
          {file.league.name} <span className="text-chalk-dim">· resoconto</span>
        </h1>
        {/*
          «firmato da PC di Edoardo» solo quando l'istanza ha un nome. Senza, la
          colonna ripiega sull'uuid — che è l'identità giusta nel file e una
          firma illeggibile in una barra: «firmato da 2ea2427e-a117-4962-…» non
          dice a nessuno chi ha chiuso l'asta. Il nome dell'installazione arriva
          con le impostazioni, T21; fino ad allora la riga si accorcia.
        */}
        <p className="min-w-0 text-chalk-dim">
          Versione {detail.version} · {when(detail.createdAt)} ·{' '}
          {/* Un'impronta e non una cifra, quindi `figure-column` e non
              `Figure`: qui serve solo l'allineamento tabulare, perché due
              impronte si confrontano una sotto l'altra — questa e quella
              scritta nelle opzioni del selettore qui accanto. */}
          <span className="figure-column">{shortHash(detail.contentHash)}</span>
          {file.producedBy.label !== null && ` · firmato da ${file.producedBy.label}`}
        </p>
        {versions.length > 1 && (
          <select
            className="ml-auto rounded-md border border-line bg-pitch-800 px-2 py-0.5 text-base"
            value={chosen ?? versions[0].version}
            onChange={(e) => {
              // La riga «Salvato in …» parla del file appena scaricato, che è
              // quello di *quella* versione: lasciata sotto un'altra direbbe una
              // cosa falsa, e `Report` non si rimonta quando la versione scelta
              // è già in cache.
              setSaved(null)
              onChoose(window.Number(e.target.value))
            }}
          >
            {/*
              Data e impronta anche nelle opzioni. Il §4.11 esclude il confronto
              fra versioni proprio perché «l'elenco con data e impronta basta a
              capire quale sia l'ultima», e il §9 lo ripete come decisione presa:
              con la sola parola «Versione 2» per sapere quando è stata fatta la
              1 bisognava selezionarla, cioè cambiare quello che si sta guardando.
            */}
            {versions.map((v) => (
              <option key={v.uuid} value={v.version}>
                Versione {v.version} · {when(v.createdAt)} · {shortHash(v.contentHash)}
              </option>
            ))}
          </select>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {/* «I numeri che alla fine si guardano sempre.» */}
        <ul className="flex flex-wrap gap-x-8 gap-y-2 pb-4">
          <Stat
            label="giocatore più pagato"
            name={report.topPurchase?.playerName ?? null}
            figure={report.topPurchase?.price ?? null}
          />
          <Stat
            label="più speso in attacco"
            name={report.topAttack?.name ?? null}
            figure={report.topAttack?.byRole.A.spent ?? null}
          />
          <Stat
            label="più crediti in mano"
            name={report.richest?.name ?? null}
            figure={report.richest?.left ?? null}
          />
        </ul>

        <ul className="flex flex-col gap-3">
          {report.teams.map((team) => (
            <li key={team.uuid} className="rounded-md border border-line bg-pitch-800">
              <header className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-3 py-1.5">
                <h2 className="min-w-0 truncate text-base">{team.name}</h2>
                {team.manager !== null && (
                  <span className="text-sm text-chalk-dim">{team.manager}</span>
                )}
                {/*
                  L'etichetta prima della cifra. «{n} spesi» concorda con
                  «crediti», che nella frase non c'è: una squadra con un solo
                  acquisto da un credito — la fine di ogni asta — leggeva «1
                  spesi». È l'ordine che usa già la board delle rose.
                */}
                {/*
                  `money` conta al nuovo valore in 200ms, e in un resoconto in
                  sola lettura l'unico modo di cambiare valore è il selettore di
                  versione: si muovono le cifre cambiate e restano ferme le
                  altre, che è la domanda di chi guarda due cristallizzazioni
                  della stessa lega.

                  Il conteggio si vede però solo **tornando** su una versione
                  già in cache. Alla prima apertura di una versione la guardia
                  `isPending` in cima smonta `Report` mentre la query è in volo,
                  e `useCountUp` comincia dal valore corrente: al montaggio non
                  parte niente. Non è un difetto — contare ha senso solo dove
                  sullo schermo c'era un «prima», e lì non c'era.
                */}
                <span className="ml-auto text-base text-chalk-dim">
                  spesi <Figure value={team.spent} kind="money" /> · in mano{' '}
                  <Figure value={team.left} kind="money" />
                </span>
              </header>

              {/* «Spesa per reparto per squadra.» */}
              <ul className="flex flex-wrap gap-x-5 border-b border-line/60 px-3 py-1 text-sm text-chalk-dim">
                {/*
                  La spesa, e non anche il numero di giocatori. Il §4.11 chiede
                  «spesa per reparto per squadra» e i giocatori sono elencati due
                  righe sotto; scritti come «portieri 32 / 3» chiedevano per
                  giunta di indovinare, in un'app dove due numeri di fila
                  significano già altro — «9 difensori su 8».

                  Il tono più tenue del secondo numero passava per
                  `text-chalk-faint`, che **non esiste**: fuori dai token di
                  Tailwind v4 non genera niente e non dà errore. Verificato sul
                  CSS costruito, zero occorrenze.
                */}
                {CLASSIC_ROLES.map((role) => (
                  <li key={role}>
                    {ROLE_LABELS[role]} <Figure value={team.byRole[role].spent} kind="money" />
                  </li>
                ))}
              </ul>

              <ul className="px-3 py-1">
                {(byTeam.get(team.uuid) ?? []).map((bought) => (
                  <li key={bought.uuid} className="flex items-baseline gap-2 py-0.5 text-base">
                    <span className="w-4 shrink-0 text-chalk-dim">{bought.slotRole}</span>
                    <span className="min-w-0 flex-1 truncate">{bought.playerName}</span>
                    {bought.playerTeam !== null && (
                      <span className="label shrink-0 text-micro text-chalk-dim">
                        {bought.playerTeam}
                      </span>
                    )}
                    <Figure
                      value={bought.price}
                      kind="money"
                      className="w-10 shrink-0 text-right"
                    />
                  </li>
                ))}
                {(byTeam.get(team.uuid) ?? []).length === 0 && (
                  <li className="py-0.5 text-base text-chalk-dim">Nessun acquisto.</li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2">
        {/*
          «Due bottoni di export, Scarica XLSX e Scarica JSON, e uno secondario,
          Riapri per modifiche», §4.11. I due primari scaricano **la versione che
          stai guardando**, non l'ultima: il selettore accanto serve a questo.
        */}
        <button
          className="rounded-md border border-line bg-pitch-700 px-3 py-1 text-base disabled:opacity-40"
          disabled={busy}
          onClick={() => void download('xlsx')}
        >
          Scarica XLSX
        </button>
        <button
          className="rounded-md border border-line bg-pitch-700 px-3 py-1 text-base disabled:opacity-40"
          disabled={busy}
          onClick={() => void download('json')}
        >
          Scarica JSON
        </button>
        {saved !== null && <p className="text-sm text-chalk-dim">Salvato in {saved}</p>}
        <p className="text-sm text-chalk-dim">
          La prossima cristallizzazione creerà la versione {versions[0].version + 1}.
        </p>
        {crystallised ? (
          <button
            className="ml-auto rounded-md border border-line px-3 py-1 text-base text-chalk-dim hover:text-chalk disabled:opacity-40"
            disabled={busy}
            onClick={() => void reopen()}
          >
            Riapri per modifiche
          </button>
        ) : (
          <p className="ml-auto text-sm text-chalk-dim">
            La lega è aperta in revisione: questo è il resoconto di com’era.
          </p>
        )}
        {refusal !== null && <p className="w-full text-base text-taken">{refusal}</p>}
      </footer>
    </div>
  )
}

/**
 * Una statistica del resoconto: un'etichetta, chi la porta, e quanto — «più
 * speso in attacco: Real Fanta 218». La cifra dentro è un `Figure`, che è il
 * componente del §10; questo è il blocchetto che la incornicia.
 *
 * `null` non è un caso di scuola: una lega chiusa senza che nessuno abbia
 * comprato un attaccante non ha un «più speso in attacco», e scrivere «Real
 * Fanta · 0 crediti» sarebbe una risposta finta a una domanda senza risposta.
 * Il ternario resta anche adesso che `Figure` sa disegnare il vuoto da sé: qui a
 * mancare non è il numero ma la statistica intera, e un trattino lungo accanto a
 * un nome che non c'è sarebbe una riga rotta, non una risposta.
 */
function Stat({
  label,
  name,
  figure,
}: {
  label: string
  name: string | null
  figure: number | null
}): JSX.Element {
  return (
    <li>
      <div className="label text-micro text-chalk-dim">{label}</div>
      <div className="text-base">
        {name === null || figure === null ? (
          <span className="text-chalk-dim">nessuno</span>
        ) : (
          <>
            {/* Tutte e tre le statistiche sono crediti — un prezzo, una spesa,
                un residuo — quindi `money`, e l'ambra la mette il componente. */}
            {name} <Figure value={figure} kind="money" />
          </>
        )}
      </div>
    </li>
  )
}
