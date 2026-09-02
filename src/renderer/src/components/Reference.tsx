import { useEffect, useState } from 'react'
import { isTypingTarget } from '@/lib/keys'

/**
 * The `?` panel of document 2 §6: "tutte le scorciatoie, e tutte le sigle
 * dell'interfaccia con il significato per esteso".
 *
 * Mounted in the shell rather than in the auction, because §6 says "ovunque" and
 * because the half that matters most — the abbreviations — belongs to the
 * players table, which is reachable without a league. §6 gives the reason for
 * the second section in a sentence worth keeping: "le sigle servono a chiunque
 * non conosca a memoria la differenza tra `Pv` e `MV`, che è quasi tutti".
 *
 * The one rule of §1 it has to obey is "niente modali durante l'asta": this is a
 * panel, not a dialog. It does not trap the focus, `Esc` closes it, and pressing
 * `?` again closes it too — so a hand that opened it by accident mid-auction gets
 * out with the key it came in on.
 */
export default function Reference(): JSX.Element | null {
  const [open, setOpen] = useState(false)

  /**
   * Registered in the **capture** phase, and stopping the event when it closes.
   *
   * Without that, `Esc` over an open reference did two things at once: this
   * panel closed and, underneath, the auction's own `Esc` threw away the
   * half-entered purchase. Both listeners sit on `window`, so bubble-phase
   * ordering is decided by which component mounted first — which is not
   * something either of them should have to know. A capture listener runs before
   * every bubble listener whatever the order, so the topmost overlay gets the
   * key and nothing below it hears it. It is the same precedence the view
   * already gives the history panel, made to work across the tree.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && open) {
        e.stopPropagation()
        setOpen(false)
        return
      }
      // Not while typing: see isTypingTarget. And not with a modifier down,
      // which on several layouts is how `?` is produced in the first place —
      // Shift is the usual one, so only Ctrl/Cmd/Alt disqualify.
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-pitch-900/70 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-md border border-line bg-pitch-800">
        <header className="flex items-center justify-between border-b border-line px-4 py-2">
          <h2 className="text-sm">Riferimento</h2>
          <button
            className="label text-sm text-chalk-dim hover:text-chalk"
            onClick={() => setOpen(false)}
          >
            Chiudi ⎋
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 overflow-auto p-4">
          <section>
            <h3 className="label mb-2 text-xs text-chalk-dim">Scorciatoie</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {SHORTCUTS.map(([keys, what]) => (
                <Row key={keys} term={keys} definition={what} mono />
              ))}
            </dl>
          </section>

          <section>
            <h3 className="label mb-2 text-xs text-chalk-dim">Sigle</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {GLOSSARY.map(([short, long]) => (
                <Row key={short} term={short} definition={long} />
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

function Row({
  term,
  definition,
  mono = false,
}: {
  term: string
  definition: string
  mono?: boolean
}): JSX.Element {
  return (
    <>
      <dt className={`whitespace-nowrap text-chalk ${mono ? 'figures' : 'label'}`}>{term}</dt>
      <dd className="text-chalk-dim">{definition}</dd>
    </>
  )
}

/**
 * The table of document 2 §6, in its order, plus the two the auction screen adds
 * for itself — opening it and closing it are not keyboard actions.
 *
 * Written out rather than collected from the handlers. A registry the components
 * pushed into would be one more thing to keep true, and this list is read once a
 * year by a person who has just pressed `?` because nothing else worked.
 */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Ctrl/Cmd+K', 'vai alla ricerca'],
  ['/', 'vai alla ricerca, fuori dai campi di testo'],
  ['↑ ↓', 'naviga i risultati'],
  ['Invio', 'conferma il passo corrente dell’assegnazione'],
  ['Esc', 'svuota e ricomincia l’inserimento'],
  ['Tab / Shift+Tab', 'campo successivo o precedente'],
  ['1–9', 'scegli la squadra n-esima, nel campo squadra'],
  ['Ctrl/Cmd+Z', 'annulla l’ultimo acquisto'],
  ['Ctrl/Cmd+H', 'cronologia delle operazioni'],
  ['Spazio', 'espandi la rosa della squadra selezionata'],
  ['Ctrl/Cmd+P', 'modo proiezione, per un secondo schermo'],
  ['?', 'questo riferimento'],
]

/*
 * Una riga della tabella §6 non è qui, e la sua assenza è voluta.
 *
 * `Ctrl/Cmd+F` «apre i filtri» di una vista Giocatori dove i filtri sono chip
 * sempre visibili nell'intestazione: non c'è niente da aprire, nemmeno col
 * mouse.
 *
 * Elencarla comunque sarebbe il peggiore dei due errori possibili. §6 dice che
 * le scorciatoie «servono una volta sola, la prima sera, ma quella sera
 * servono»: chi apre questo pannello ci arriva perché nient'altro ha
 * funzionato, e una riga che promette un tasto morto lo manda a cercare il
 * guasto dalla parte sbagliata. Torna quando torna vera.
 *
 * `Ctrl/Cmd+P` era qui accanto fino a T15 per la stessa ragione, ed è tornato
 * insieme al modo proiezione.
 */

/**
 * Every abbreviation the interface prints, spelled out.
 *
 * The list is the columns of the players table of document 2 §4.4 plus the two
 * the auction adds. `cr` and `max` are here because the rose grid writes them
 * next to a figure and nowhere explains them, which is the exact complaint §6
 * raises about `Pv` and `MV`.
 */
const GLOSSARY: ReadonlyArray<readonly [string, string]> = [
  ['ruo', 'ruolo Classic: portiere, difensore, centrocampista, attaccante'],
  ['squa', 'squadra di Serie A'],
  ['qt.', 'quotazione attuale sul listone'],
  ['FVM', 'Fanta Valore di Mercato: quanto vale all’asta secondo Fantacalcio.it'],
  ['FM', 'fantamedia: media dei voti con bonus e malus'],
  ['MV', 'media voto: la media senza bonus né malus'],
  ['Pv', 'partite con voto: quante volte ha preso un voto'],
  ['bon', 'quanto la fantamedia supera la media voto: il peso dei bonus'],
  ['pt.', 'punteggio: quanto vale nel complesso, sulla scala di una fantamedia'],
  [
    'pr.',
    'prezzo atteso: quanto dovrebbe costare, dividendo i crediti della lega fra i giocatori che entrano in rosa',
  ],
  ['tit.', 'titolarità: quota di partite giocate dall’inizio'],
  ['min', 'minuti giocati per partita'],
  ['CS', 'clean sheet: quota di partite da titolare senza subire gol'],
  ['cr', 'crediti ancora da spendere'],
  ['max', 'puntata massima: il più che può offrire tenendo un credito per ogni slot libero'],
]
