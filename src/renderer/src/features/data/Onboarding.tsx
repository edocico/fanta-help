import { useState } from 'react'
import Figure from '@/components/Figure'
import { call, IpcError } from '@/lib/ipc'
import { errorMessages } from '@shared/errors'
import type { Output } from '@shared/contracts'

/**
 * Onboarding dati, document 2 §4.1: one screen, two possibilities, no suggested
 * preference.
 *
 * The download half belongs to T7b — the manifest lives in a private repo behind
 * a build-injected token, and until that exists there is no URL to point at. It
 * is shown anyway, and says so: document 4 §9 already treats the XLSX as a
 * complete alternative route rather than a fallback, so a screen offering only
 * one of the two would be describing the app wrongly rather than describing it
 * early.
 */

type Preview = Output<'listone.preview'>
type Report = Output<'listone.import'>

/** `2026-27`. Checked here for courtesy; the service builds the row regardless. */
const SEASON = /^\d{4}-\d{2}$/

function message(e: unknown): string {
  return e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE()
}

export default function Onboarding({ onDone }: { onDone: () => void }): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [seasonId, setSeasonId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  async function pick(): Promise<void> {
    setError(null)
    try {
      const chosen = await call('listone.pick')
      if (!chosen) return // cancelled: not an error, and not worth a message
      setBusy(true)
      const read = await call('listone.preview', { filePath: chosen.filePath })
      setFilePath(chosen.filePath)
      setPreview(read)
      // The proposal of document 4 §6: what the file name says, else the most
      // recent season already installed. Never silently applied — it lands in a
      // field the person has to look at.
      setSeasonId(read.seasonGuess ?? read.seasons.at(-1)?.id ?? '')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!filePath) return
    setBusy(true)
    setError(null)
    try {
      setReport(await call('listone.import', { filePath, seasonId }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const known = preview?.seasons.find((s) => s.id === seasonId)
  const canImport = preview !== null && preview.refusal === null && SEASON.test(seasonId)

  if (report) {
    return (
      <Frame>
        <h1 className="text-lg font-medium">Listone importato</h1>
        <p className="mt-2 text-base text-fg-muted">
          {report.label} · {report.added + report.updated} giocatori, {report.teams} squadre.
          {report.delisted > 0 && ` ${report.delisted} non sono più nel listone e restano marcati.`}
        </p>
        <p className="mt-1 text-base text-fg-muted">
          {report.statsUntouched > 0
            ? `Le ${report.statsUntouched} righe di storico non sono state toccate: il file delle quotazioni non contiene statistiche.`
            : 'Non c’è storico per questa stagione: le colonne di rendimento restano vuote finché non importi un dataset completo.'}
        </p>
        <button className={PRIMARY} onClick={onDone}>
          Continua
        </button>
      </Frame>
    )
  }

  return (
    <Frame>
      <h1 className="text-lg font-medium">Servono i giocatori</h1>
      <p className="mt-2 text-base text-fg-muted">
        Fanta Help parte da un listone di Serie A. Puoi scaricarlo o importarlo da un file.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Present and honest about itself, rather than absent. T7b turns it on. */}
        <section className="rounded-md border border-line bg-surface-panel p-4 opacity-60">
          <h2 className="text-title font-medium">Scarica il listone</h2>
          <p className="mt-1 text-base text-fg-muted">
            Non ancora disponibile: arriva col collegamento alla repo del listone. Intanto usa il
            file XLSX di Fantacalcio.it.
          </p>
          <button className={SECONDARY} disabled>
            Scarica
          </button>
        </section>

        <section className="rounded-md border border-line bg-surface-panel p-4">
          <h2 className="text-title font-medium">Importa un file</h2>
          <p className="mt-1 text-base text-fg-muted">
            Le quotazioni scaricate da Fantacalcio.it, in formato XLSX.
          </p>
          <button className={PRIMARY} onClick={() => void pick()} disabled={busy}>
            {preview ? 'Scegli un altro file' : 'Scegli un file'}
          </button>
        </section>
      </div>

      {error && <p className="mt-4 text-base text-blocking">{error}</p>}

      {preview && (
        <div className="mt-6 rounded-md border border-line bg-surface-panel p-4">
          <h2 className="text-title font-medium">{preview.file}</h2>

          {preview.refusal ? (
            <p className="mt-2 text-base text-blocking">{preview.refusal.message}</p>
          ) : (
            <p className="mt-2 text-base text-fg-muted">
              {preview.validRows} giocatori, intestazione alla riga {preview.headerRow}.
            </p>
          )}

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-base sm:grid-cols-[10rem_1fr]">
            {/* None of the three lists below is a figure, though they are text for two
                different reasons: `recognised` and `unrecognised` are header strings as
                the chosen workbook spells them, while `missing` are the names this app
                asks for and did not find — `QUOTAZIONI_COLUMNS` in `shared/listone.ts`,
                so `Nome`, `Qt.A`. Either way `.figures` had to go, and nothing replaces
                it: `figure-column` aligns digits under one another and here there is no
                column. `.figures` was wrong on its own terms too — it is Archivo, at the
                14px of this `dl`, which §15 forbids. */}
            <dt className="label text-micro text-fg-muted">colonne riconosciute</dt>
            <dd>{preview.recognised.join(', ') || '—'}</dd>

            {preview.missing.length > 0 && (
              <>
                <dt className="label text-micro text-fg-muted">colonne mancanti</dt>
                <dd className="text-blocking">{preview.missing.join(', ')}</dd>
              </>
            )}

            {preview.unrecognised.length > 0 && (
              <>
                <dt className="label text-micro text-fg-muted">colonne ignorate</dt>
                <dd className="text-fg-muted">{preview.unrecognised.join(', ')}</dd>
              </>
            )}

            {preview.rejectedTotal > 0 && (
              <>
                <dt className="label text-micro text-fg-muted">righe scartate</dt>
                <dd className="text-fg-muted">
                  {/* A count, alone in its element, so it is a figure — `whole` and not
                      `money`: rows are not credits, and the amber is money and nothing
                      else (§15). The lines beneath it are the service's own sentences
                      and stay text. */}
                  <Figure value={preview.rejectedTotal} />
                  <ul className="mt-1 space-y-0.5">
                    {preview.rejected.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>

          {preview.refusal === null && (
            <div className="mt-5 border-t border-line pt-4">
              {/* Document 4 §6: the file does not say its season reliably, so the
                  import always asks — even when the guess looks obvious. */}
              <label className="label text-micro block text-fg-muted" htmlFor="season">
                stagione
              </label>
              {/* `2026-27` is a label, not a figure: §4 gives family and weight to
                  numbers, and this is a code someone types. Not `figure-column` either
                  — there is nothing to align in a one-line field — so the field now reads
                  like the season buttons below it, which never wore a figure class. */}
              <input
                id="season"
                className="mt-1 w-32 rounded-md border border-line bg-surface px-2 py-1 text-base"
                value={seasonId}
                onChange={(e) => setSeasonId(e.target.value.trim())}
                placeholder="2026-27"
              />
              {preview.seasons.length > 0 && (
                <p className="mt-2 text-base text-fg-muted">
                  già installate:{' '}
                  {preview.seasons.map((s) => (
                    <button
                      key={s.id}
                      className="mr-2 underline underline-offset-2"
                      onClick={() => setSeasonId(s.id)}
                    >
                      {s.id}
                    </button>
                  ))}
                </p>
              )}

              <p className="mt-3 text-base text-fg-muted">
                {known && known.stats > 0
                  ? `Le ${known.stats} righe di storico di ${known.label} restano come sono: questo file contiene solo quotazioni e ruoli.`
                  : 'Questa stagione non ha storico: le colonne di rendimento resteranno vuote finché non importi un dataset completo.'}
              </p>

              <button className={PRIMARY} onClick={() => void confirm()} disabled={!canImport || busy}>
                {busy ? 'Importo…' : 'Importa'}
              </button>
            </div>
          )}
        </div>
      )}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-3xl px-6 py-12">{children}</div>
    </div>
  )
}

const PRIMARY =
  'mt-4 rounded-md bg-surface-raised px-3 py-1.5 text-base text-fg hover:bg-line disabled:opacity-40'
const SECONDARY =
  'mt-4 rounded-md border border-line px-3 py-1.5 text-base text-fg-muted disabled:opacity-40'
