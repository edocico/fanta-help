import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { call, IpcError } from '@/lib/ipc'
import { errorMessages } from '@shared/errors'
import type { UpdateStatus } from '@shared/contracts'
import { useUpdateStatus } from './useUpdateStatus'

const PRIMARY =
  'rounded-md bg-surface-raised px-3 py-1.5 text-base text-fg hover:bg-line disabled:opacity-40'
const SECONDARY =
  'rounded-md border border-line px-3 py-1.5 text-base text-fg-muted hover:text-fg disabled:opacity-40'

/**
 * Impostazioni, e per ora la sola sezione Aggiornamenti — T20.
 *
 * Le sezioni sono quattro — Dati, Aggiornamenti, Aspetto, Backup — e le
 * elenca la mappa delle viste, il §3; il §4.12 ne descrive due, Dati e
 * Aggiornamenti. Le altre tre sono T21 e non ci sono: una di esse, «Dati», chiede la
 * chiave API con la quota residua, che è T19 e non esiste. Costruirle a metà
 * per riempire la pagina direbbe che sono fatte.
 *
 * Non ha una lega: come Giocatori, sta fuori dal gruppo di viste che una lega
 * possiede, e infatti la sua voce nella barra laterale sta sotto la stessa
 * riga.
 */
export default function SettingsView(): JSX.Element {
  const instance = useQuery({ queryKey: ['app.instance'], queryFn: () => call('app.instance') })
  const status = useUpdateStatus()

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-display text-heading font-medium">Impostazioni</h1>

      <section className="mt-6">
        <h2 className="text-title font-medium">Aggiornamenti</h2>
        <Updates status={status} version={instance.data?.version ?? null} />
      </section>
    </div>
  )
}

/**
 * Le sei righe della tabella del §4.12, più i due stati che quella tabella non
 * disegna.
 *
 * `idle` e `checking` non ci sono nel documento perché durano quanto una
 * richiesta di rete — ma esistono, e uno schermo che non dice niente mentre
 * sta facendo qualcosa è il difetto che questa app evita ovunque. `idle` dura
 * i quattro secondi fra l'avvio e il primo controllo.
 */
function Updates({
  status,
  version,
}: {
  status: UpdateStatus
  version: string | null
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  /**
   * Un solo posto in cui si chiama il main, e un solo posto in cui il rifiuto
   * diventa testo.
   *
   * Il rifiuto che conta è quello dell'installazione con un'asta in corso, e
   * arriva **dal servizio**: l'interfaccia non lo prevede né lo anticipa, come
   * vuole la regola 2. Fra il momento in cui il bottone si accende e il clic
   * può passare un'intera asta.
   */
  const run = async (what: 'update.check' | 'update.download' | 'update.install'): Promise<void> => {
    setBusy(true)
    setRefusal(null)
    try {
      await call(what)
    } catch (e) {
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      {/* La versione installata, tranne quando lo stato la dice già: il §4.12
          scrive per «Nessun aggiornamento» la frase intera, «Fanta Help 1.2.0 è
          l'ultima versione», e sopra di essa questa riga stampava lo stesso
          numero una seconda volta, impilato. Visto nell'app, non dedotto. */}
      {status.state !== 'none' && (
        <p className="text-base text-fg-muted">Fanta Help {version ?? '—'}</p>
      )}

      <div className="mt-3">
        {/* Non «Non ho ancora controllato»: era l'unica frase dell'app al
            passato in prima persona, e accanto a un bottone che diceva
            «Ricontrolla» suonava come una scusa per non essersi mossa. Lo
            stato dice cosa c'è, l'invito ad agire è il bottone. */}
        {status.state === 'idle' && (
          <p className="text-base text-fg-muted">Nessun controllo ancora.</p>
        )}

        {status.state === 'checking' && <p className="text-base text-fg-muted">Controllo…</p>}

        {status.state === 'none' && (
          // Il `—` di casa sta in una casella di valore, mai dentro una frase
          // corrente: «Fanta Help — è l'ultima versione» esce spezzata. Se
          // `app.instance` non ha risposto, la frase fa a meno del numero.
          <p className="text-base text-fg">
            {version === null ? 'È l’ultima versione.' : `Fanta Help ${version} è l’ultima versione.`}
          </p>
        )}

        {status.state === 'available' && (
          <>
            <p className="text-base text-fg">La versione {status.version} è disponibile.</p>
            <Notes html={status.notes} />
          </>
        )}

        {status.state === 'downloading' && (
          <span className="flex items-center gap-2">
            {/* La stessa barra di `Home`, che è l'unica dell'app: il §10 del
                documento 7 non elenca un componente per l'avanzamento, quindi
                si copia la forma esistente invece di inventarne una seconda.
                Nessuna interpolazione fra i valori: il renderer non porta
                nessuna utility di quella famiglia, e il §7 chiude le animazioni
                a quattro. Il movimento qui è il valore che cambia, non una
                durata. La classe non è scritta nemmeno qui: Tailwind scandisce
                i commenti come testo e la nominarla la rigenererebbe nel CSS
                costruito, falsificando il controllo «zero usi, zero regole». */}
            <span className="figure-column text-base text-fg-muted">
              {Math.round(status.percent)}%
            </span>
            <span className="block h-1 w-24 rounded-sm bg-surface-raised">
              <span
                className="block h-1 rounded-sm bg-fg-muted"
                style={{ width: `${Math.min(100, Math.max(0, status.percent))}%` }}
              />
            </span>
          </span>
        )}

        {status.state === 'ready' && (
          <p className="text-base text-fg">La versione {status.version} è pronta.</p>
        )}

        {status.state === 'manual' && (
          <p className="text-base text-fg">La versione {status.version} è disponibile.</p>
        )}

        {status.state === 'error' && <p className="text-base text-blocking">{status.message}</p>}
      </div>

      {refusal !== null && <p className="mt-2 text-base text-blocking">{refusal}</p>}

      <div className="mt-3 flex items-center gap-2">
        {status.state === 'available' && (
          <button className={PRIMARY} disabled={busy} onClick={() => void run('update.download')}>
            Scarica
          </button>
        )}

        {status.state === 'ready' && (
          <button className={PRIMARY} disabled={busy} onClick={() => void run('update.install')}>
            Riavvia e installa
          </button>
        )}

        {/* Lo stesso canale del bottone «Riavvia e installa», e non è una
            svista: su una build che non sa installarsi da sé `update.install`
            apre la pagina invece di riavviare. La scelta sta nel servizio, dove
            la costante di build è nota, e non qui. */}
        {status.state === 'manual' && (
          <button className={PRIMARY} disabled={busy} onClick={() => void run('update.install')}>
            Apri la pagina di download
          </button>
        )}

        {/* Il bottone che c'è sempre. Il §4.12 lo nomina per «Nessun
            aggiornamento» e per «Errore»; tenerlo anche negli altri stati non
            toglie niente e evita uno schermo senza uscita mentre un controllo
            è rimasto appeso. */}
        <button
          className={SECONDARY}
          disabled={busy || status.state === 'checking' || status.state === 'downloading'}
          onClick={() => void run('update.check')}
        >
          {/* Tre etichette e non due: in `idle` il prefisso di «Ricontrolla»
              prometterebbe un controllo precedente che la riga sopra nega. */}
          {status.state === 'error'
            ? 'Riprova'
            : status.state === 'idle'
              ? 'Controlla'
              : 'Ricontrolla'}
        </button>
      </div>
    </div>
  )
}

/**
 * Le note della release, che arrivano in **HTML**.
 *
 * Il provider GitHub di electron-updater le legge dal feed Atom della Release,
 * quindi sono il markup di quello che qualcuno ha scritto lì dentro. Non vanno
 * in un `dangerouslySetInnerHTML`: sarebbe far eseguire alla finestra dell'app
 * il contenuto di un campo di testo remoto, e questa applicazione gira con
 * `nodeIntegration: false` proprio per non doversi fidare di niente del genere.
 *
 * `DOMParser` estrae il testo senza eseguire niente: un documento creato così è
 * inerte — gli script non girano, le immagini non si caricano. Resta il testo,
 * che è quello che il §4.12 chiede di mostrare.
 */
function Notes({ html }: { html?: string }): JSX.Element | null {
  if (html === undefined || html.trim() === '') return null

  const doc = new DOMParser().parseFromString(html, 'text/html')
  // `textContent` concatena e basta: `<h2>Novità</h2><p>…</p>` esce «NovitàLe
  // note…», e le note di una Release vera sono fatte di titoli e elenchi, cioè
  // quasi tutte righe incollate. Misurato nell'app prima che questa riga
  // esistesse. Una interruzione dopo ogni blocco, e `whitespace-pre-line` sotto
  // le rende.
  for (const block of doc.querySelectorAll('p, div, li, br, tr, h1, h2, h3, h4, h5, h6')) {
    block.after('\n')
  }
  const text = (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
  if (text === '') return null
  return <p className="mt-1 whitespace-pre-line text-base text-fg-muted">{text}</p>
}
