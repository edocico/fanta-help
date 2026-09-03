import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import { errorMessages, notices, purchases, teams } from '@shared/errors'
import { shortHash, when } from '@/lib/format'
import type { Output } from '@shared/contracts'

type Preview = Output<'snapshot.preview'>

/**
 * «Import JSON per riprendere o spostare una sessione», documento 1 §2.
 *
 * Sta nella home e non nel resoconto perché il resoconto è una schermata *di
 * una lega*, e questo file una lega la porta con sé: la stessa che c'è già, o
 * una che qui non esiste ancora.
 *
 * Anteprima e conferma, come l'import del listone: la sostituzione cancella gli
 * acquisti e le versioni locali, ed è l'unica scrittura dell'app che toglie
 * qualcosa a una lega che non hai appena guardato. Il §1 non vuole finestre di
 * conferma per i gesti dell'asta, dove il rimedio è l'annulla; qui l'annulla non
 * c'è, e il rimedio sarebbe il backup — che esiste, ma è un file da ritrovare.
 */
/**
 * Un hook e non un componente, perché i suoi due pezzi vanno in due posti.
 *
 * Il bottone vive nell'intestazione, accanto a «Nuova lega»; l'anteprima è larga
 * quanto la pagina e va sotto. Resi insieme da un componente, la `section`
 * diventava il terzo elemento della riga flex dell'intestazione — incastrata fra
 * i due bottoni — e i suoi `mt-6` non mettevano niente sotto: allungavano la
 * riga. Una prop «dove mettere il pannello» non avrebbe risolto niente: una
 * funzione che torna JSX rende comunque dove viene chiamata.
 */
export function useImportSession(): { button: JSX.Element; panel: JSX.Element | null } {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function message(e: unknown): string {
    return e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE()
  }

  async function pick(): Promise<void> {
    setError(null)
    try {
      const chosen = await call('snapshot.pick')
      if (!chosen) return // annullato: non è un errore
      setBusy(true)
      setPreview(await call('snapshot.preview', { filePath: chosen.filePath }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const report = await call('snapshot.import', { filePath: preview.file })
      await queryClient.invalidateQueries()
      setPreview(null)
      navigate(`/lega/${report.leagueId}/resoconto`)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const button = (
    <button
      className="rounded-md border border-line px-3 py-1.5 text-sm text-chalk-dim hover:text-chalk disabled:opacity-40"
      disabled={busy}
      onClick={() => void pick()}
    >
      Importa una sessione
    </button>
  )

  const panel =
    error !== null && preview === null ? (
      <p className="mt-4 text-sm text-taken">{error}</p>
    ) : preview === null ? null : (
      <section className="mt-6 rounded-md border border-line bg-pitch-800 p-4">
          <h2 className="text-sm">
            {preview.leagueName} <span className="text-chalk-dim">· versione {preview.version}</span>
          </h2>
          {/*
            Data e impronta, che è la coppia con cui il §4.11 dice di riconoscere
            una versione — e qui serve più che altrove: la domanda, davanti a una
            lega che verrà sostituita, è «questo file è più recente di quello che
            ho?».

            La firma solo quando l'istanza ha un nome, come nella barra del
            resoconto: senza, `producedBy` ripiega sull'uuid, e «firmato da
            2ea2427e-a117-4962-…» non dice a nessuno chi ha chiuso l'asta.
          */}
          <p className="pt-1 text-sm text-chalk-dim">
            {preview.seasonId} · {teams(preview.teams)} · {purchases(preview.purchases)} ·{' '}
            {when(preview.createdAt)} · <span className="figure-column">{shortHash(preview.contentHash)}</span>
            {preview.producedBy !== null && ` · firmato da ${preview.producedBy}`}
          </p>

          {preview.replaces !== null && (
            /**
             * Cosa se ne va, detto prima e per intero.
             *
             * Le versioni sono la parte che non torna: il file ne porta una, e
             * quelle cristallizzate qui non stanno da nessun'altra parte.
             */
            <p className="pt-3 text-sm text-taken">{notices.REPLACING_LEAGUE(preview.replaces)}</p>
          )}

          {preview.refusal !== null && (
            <p className="pt-3 text-sm text-taken">{preview.refusal.message}</p>
          )}

          {error !== null && <p className="pt-3 text-sm text-taken">{error}</p>}

          <div className="flex gap-3 pt-4">
            <button
              className="rounded-md bg-pitch-700 px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={busy || preview.refusal !== null}
              onClick={() => void confirm()}
            >
              {busy ? 'Importo…' : preview.replaces !== null ? 'Sostituisci la lega' : 'Importa'}
            </button>
            <button
              className="rounded-md border border-line px-3 py-1.5 text-sm text-chalk-dim hover:text-chalk"
              onClick={() => {
                setPreview(null)
                setError(null)
              }}
            >
              Annulla
            </button>
          </div>
      </section>
    )

  return { button, panel }
}
