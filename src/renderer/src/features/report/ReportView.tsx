import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import { useLeagueStore } from '@/stores/league'
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
        <p className="text-sm text-taken">
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
        <p className="text-sm text-chalk-dim">{errorMessages.LEAGUE_MISSING()}</p>
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
        <p className="pb-1 text-sm text-chalk-dim">
          {league.data.league.name} <span>· resoconto</span>
        </p>
        <p className="max-w-xl pt-2 text-sm text-chalk-dim">
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

/**
 * «5 settembre, 23:41», la barra del §4.11 alla lettera.
 *
 * Due formattatori e non uno: chiedendo a `Intl` giorno, mese e ora insieme, in
 * italiano esce «2 settembre alle ore 22:06», che è corretto e non è quello che
 * il documento scrive. La virgola la mettiamo noi.
 */
const day = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' })
const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

function when(at: number): string {
  const d = new Date(at)
  return `${day.format(d)}, ${time.format(d)}`
}

/** `sha256:a91f4c2…` → `a91f4c2`, che è quanto ne scrive la barra del §4.11. */
function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, '').slice(0, 7)
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
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-sm">
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
          <span className="figures">{shortHash(detail.contentHash)}</span>
          {file.producedBy.label !== null && ` · firmato da ${file.producedBy.label}`}
        </p>
        {versions.length > 1 && (
          <select
            className="ml-auto rounded-md border border-line bg-pitch-800 px-2 py-0.5 text-sm"
            value={chosen ?? versions[0].version}
            onChange={(e) => onChoose(window.Number(e.target.value))}
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
          <Figure
            label="giocatore più pagato"
            name={report.topPurchase?.playerName ?? null}
            figure={report.topPurchase?.price ?? null}
          />
          <Figure
            label="più speso in attacco"
            name={report.topAttack?.name ?? null}
            figure={report.topAttack?.byRole.A.spent ?? null}
          />
          <Figure
            label="più crediti in mano"
            name={report.richest?.name ?? null}
            figure={report.richest?.left ?? null}
          />
        </ul>

        <ul className="flex flex-col gap-3">
          {report.teams.map((team) => (
            <li key={team.uuid} className="rounded-md border border-line bg-pitch-800">
              <header className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-3 py-1.5">
                <h2 className="min-w-0 truncate text-sm">{team.name}</h2>
                {team.manager !== null && (
                  <span className="text-xs text-chalk-dim">{team.manager}</span>
                )}
                {/*
                  L'etichetta prima della cifra. «{n} spesi» concorda con
                  «crediti», che nella frase non c'è: una squadra con un solo
                  acquisto da un credito — la fine di ogni asta — leggeva «1
                  spesi». È l'ordine che usa già la board delle rose.
                */}
                <span className="ml-auto text-sm text-chalk-dim">
                  spesi <span className="figures text-credit">{team.spent}</span> · in mano{' '}
                  <span className="figures text-credit">{team.left}</span>
                </span>
              </header>

              {/* «Spesa per reparto per squadra.» */}
              <ul className="flex flex-wrap gap-x-5 border-b border-line/60 px-3 py-1 text-xs text-chalk-dim">
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
                    {ROLE_LABELS[role]}{' '}
                    <span className="figures text-credit">{team.byRole[role].spent}</span>
                  </li>
                ))}
              </ul>

              <ul className="px-3 py-1">
                {(byTeam.get(team.uuid) ?? []).map((bought) => (
                  <li key={bought.uuid} className="flex items-baseline gap-2 py-0.5 text-sm">
                    <span className="w-4 shrink-0 text-chalk-dim">{bought.slotRole}</span>
                    <span className="min-w-0 flex-1 truncate">{bought.playerName}</span>
                    {bought.playerTeam !== null && (
                      <span className="label shrink-0 text-xs text-chalk-dim">
                        {bought.playerTeam}
                      </span>
                    )}
                    <span className="figures w-10 shrink-0 text-right text-credit">
                      {bought.price}
                    </span>
                  </li>
                ))}
                {(byTeam.get(team.uuid) ?? []).length === 0 && (
                  <li className="py-0.5 text-sm text-chalk-dim">Nessun acquisto.</li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2">
        <p className="text-xs text-chalk-dim">
          La prossima cristallizzazione creerà la versione {versions[0].version + 1}.
        </p>
        {crystallised ? (
          <button
            className="ml-auto rounded-md border border-line px-3 py-1 text-sm text-chalk-dim hover:text-chalk disabled:opacity-40"
            disabled={busy}
            onClick={() => void reopen()}
          >
            Riapri per modifiche
          </button>
        ) : (
          <p className="ml-auto text-xs text-chalk-dim">
            La lega è aperta in revisione: questo è il resoconto di com’era.
          </p>
        )}
        {refusal !== null && <p className="w-full text-sm text-taken">{refusal}</p>}
      </footer>
    </div>
  )
}

/**
 * Un numero del resoconto, o la sua assenza detta a parole.
 *
 * `null` non è un caso di scuola: una lega chiusa senza che nessuno abbia
 * comprato un attaccante non ha un «più speso in attacco», e scrivere «Real
 * Fanta · 0 crediti» sarebbe una risposta finta a una domanda senza risposta.
 */
function Figure({
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
      <div className="label text-xs text-chalk-dim">{label}</div>
      <div className="text-sm">
        {name === null || figure === null ? (
          <span className="text-chalk-dim">nessuno</span>
        ) : (
          <>
            {name} <span className="figures text-credit">{figure}</span>
          </>
        )}
      </div>
    </li>
  )
}
