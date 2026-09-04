import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { call } from '@/lib/ipc'
import { isTypingTarget } from '@/lib/keys'
import { usePlayersStore } from '@/stores/players'
import {
  CLASSIC_ROLES,
  MANTRA_LABELS,
  MANTRA_ROLES,
  ROLE_LABELS_ONE,
} from '@shared/domain'
import { ABBREVIATIONS, glossary } from '@shared/glossary'

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

  // Prima del ritorno anticipato: le regole dei hook non ammettono un `useQuery`
  // dopo un `return`, e le due query sono comunque spente finché `open` è falso.
  const clubs = useClubs(open)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface/70 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface-panel">
        <header className="flex items-center justify-between border-b border-line px-4 py-2">
          <h2 className="text-title">Riferimento</h2>
          <button
            className="label text-micro text-fg-muted hover:text-fg"
            onClick={() => setOpen(false)}
          >
            Chiudi ⎋
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-6 gap-y-5 overflow-auto p-4">
          <Section title="Scorciatoie">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
              {SHORTCUTS.map(([keys, what]) => (
                <Row key={keys} term={keys} definition={what} figures />
              ))}
            </dl>
          </Section>

          {/* Espansione **e** spiegazione, §10: sapere che `FM` sta per
              "fantamedia" non dice cosa sia una fantamedia. Sono i due campi del
              glossario, ed è lo stesso testo che il popover mostra — un solo
              posto da correggere quando una definizione si rivela storta. */}
          <Section title="Sigle">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-base">
              {ABBREVIATIONS.map((abbr) => (
                <Row
                  key={abbr}
                  term={abbr}
                  definition={
                    <>
                      <span className="block text-fg">{glossary[abbr].full}</span>
                      {glossary[abbr].explains}
                    </>
                  }
                />
              ))}
            </dl>
          </Section>

          {/* I ruoli non stanno nel glossario e questa sezione è il perché: `C` e
              `A` compaiono in tutti e due gli insiemi con due significati, quindi
              un oggetto solo non può tenerli. Un pannello sì, sotto due titoli. */}
          <Section title="Ruoli Classic">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
              {CLASSIC_ROLES.map((role) => (
                <Row key={role} term={role} definition={ROLE_LABELS_ONE[role]} />
              ))}
            </dl>
          </Section>

          <Section title="Ruoli Mantra">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
              {MANTRA_ROLES.map((role) => (
                <Row key={role} term={role} definition={MANTRA_LABELS[role]} />
              ))}
            </dl>
          </Section>

          {clubs.length > 0 && (
            <Section title="Squadre" wide>
              <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 text-base">
                {clubs.map((club) => (
                  <Row key={club.code} term={club.code} definition={club.name} />
                ))}
              </dl>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The three-letter club codes, read from the data and not written down.
 *
 * They are the one set §10 lists that cannot be a glossary entry: all twenty are
 * derived at build time from the club name and change with every promotion and
 * relegation — the installed dataset still carries FRO, MON and VEN. Written by
 * hand they would be three keys matching nothing and three clubs with no entry,
 * and nothing would fail.
 *
 * Fetched only once the panel is open, and on the key the players view already
 * uses, so it is free whenever that view has been visited and one call when it
 * has not. The season is the same fallback the players view applies: the store
 * holds an override, and `null` there means "the most recent import".
 */
function useClubs(open: boolean): { code: string; name: string }[] {
  const override = usePlayersStore((s) => s.seasonId)
  const seasons = useQuery({
    queryKey: ['dataset.list'],
    queryFn: () => call('dataset.list'),
    enabled: open,
  })
  const seasonId = override ?? seasons.data?.[0]?.id ?? null
  const list = useQuery({
    queryKey: ['player.list', { seasonId }],
    queryFn: () => call('player.list', { seasonId: seasonId as string }),
    enabled: open && seasonId !== null,
  })

  return useMemo(() => {
    const byCode = new Map<string, string>()
    for (const p of list.data?.players ?? []) {
      if (p.teamCode !== null && !byCode.has(p.teamCode)) byCode.set(p.teamCode, p.teamName)
    }
    return [...byCode]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [list.data])
}

function Section({
  title,
  wide = false,
  children,
}: {
  title: string
  wide?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className={wide ? 'col-span-2' : undefined}>
      <h3 className="label mb-2 text-micro text-fg-muted">{title}</h3>
      {children}
    </section>
  )
}

function Row({
  term,
  definition,
  figures = false,
}: {
  term: string
  definition: React.ReactNode
  /** Only the key names: they are glyphs in a column and want tabular figures.
   *  An abbreviation is a word and takes the interface face. */
  figures?: boolean
}): JSX.Element {
  return (
    <>
      <dt className={`whitespace-nowrap text-fg ${figures ? 'figure-column' : 'label text-micro'}`}>
        {term}
      </dt>
      <dd className="text-fg-muted">{definition}</dd>
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

/*
 * Il glossario non è più qui.
 *
 * Stava in questo file come quindici coppie `[sigla, definizione]`, ed era la
 * cosa più vicina a una fonte unica che il progetto avesse — ma era nel
 * renderer, aveva un campo di testo solo dove il §10 ne vuole due, e soprattutto
 * non era sola: `PlayerDetail` portava un secondo insieme di spiegazioni per
 * `bon`, `tit.`, `min` e `CS`, diverse parola per parola. Ora sta in
 * `src/shared/glossary.ts`, lo leggono questo pannello, il popover di `Abbr` e le
 * righe degli indicatori, e il tipo `Abbr` impedisce che una sigla senza voce
 * arrivi allo schermo.
 *
 * Il commento che stava qui dichiarava «every abbreviation the interface
 * prints»: misurato, ne mancavano diciassette — le quattordici lettere di
 * ruolo, `qt. iniziale`, `#` e `★`, che era già l'intestazione di una colonna.
 * L'app ne disegna trentadue: le diciotto del glossario e le quattordici
 * lettere. Le lettere di ruolo hanno adesso due sezioni proprie, per
 * la collisione fra `C` e `A` che nessun oggetto solo può tenere.
 */
