import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import { errorMessages, teams } from '@shared/errors'
import type { LeagueSummary } from '@shared/types'
import { FORMAT_LABELS, MODE_LABELS, STATUS_LABELS } from './labels'
import { useImportSession } from './ImportSession'

/**
 * The home of document 2 §4.2: "elenco delle leghe come righe, non card".
 *
 * Rows because this is the app that replaces a spreadsheet — document 2 §2 —
 * and because six leagues in six cards is a page of decoration around twelve
 * words. The progress bar appears only with an auction under way, which is what
 * §4.2 asks for and also the only moment it means anything: before the first
 * purchase it would be an empty rail on every row.
 */

export default function Home(): JSX.Element {
  const leagues = useQuery({ queryKey: ['league.list'], queryFn: () => call('league.list') })
  const importer = useImportSession()

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-lg font-medium">Leghe</h1>
        <div className="flex items-center gap-3">
          {/* L'import sta qui perché porta una lega: è l'altra metà di «Nuova
              lega», non un'azione dentro una lega che esiste già. Il suo
              pannello no: quello va sotto l'intestazione, fuori dalla riga. */}
          {importer.button}
          <Link
            to="/lega/nuova"
            className="rounded-md bg-pitch-700 px-3 py-1.5 text-base text-chalk hover:bg-line"
          >
            Nuova lega
          </Link>
        </div>
      </header>

      {importer.panel}

      {leagues.isError && (
        <p className="mt-6 text-base text-taken">
          {leagues.error instanceof IpcError
            ? leagues.error.message
            : errorMessages.IPC_UNAVAILABLE()}
        </p>
      )}

      {leagues.data?.length === 0 && (
        // Document 2 §8, parola per parola.
        <p className="mt-6 text-base text-chalk-dim">
          Nessuna lega. Creane una per iniziare a preparare l’asta.
        </p>
      )}

      {leagues.data && leagues.data.length > 0 && (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {leagues.data.map((league) => (
            <Row key={league.id} league={league} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ league }: { league: LeagueSummary }): JSX.Element {
  return (
    <li>
      <Link
        to={`/lega/${league.id}`}
        className="flex items-center gap-4 px-2 py-2.5 hover:bg-pitch-800"
      >
        <span className="w-64 truncate font-medium">{league.name}</span>
        {/* No figure class at all: `season.label` renders "Serie A 2026/27" —
            read back from the dev database, not the bare year pair the name
            suggests. Two words and a slash carry no figure, so §4's column
            role would only set the words in Plex 500 beside two neighbouring
            columns at 400. And dropping `figures` drops Archivo at 12px,
            which §15 forbids. */}
        <span className="w-20 text-base text-chalk-dim">{league.seasonLabel}</span>
        <span className="w-24 text-base text-chalk-dim">{MODE_LABELS[league.mode]}</span>
        <span className="w-28 text-base text-chalk-dim">{FORMAT_LABELS[league.auctionFormat]}</span>
        {/* `teams()` counts in Italian — "1 squadra" / "12 squadre" — so the
            number never leaves the sentence and only the class changes. */}
        <span className="figure-column w-20 text-base text-chalk-dim">{teams(league.teamCount)}</span>
        <span className="ml-auto flex items-center gap-3">
          {league.status === 'auction' && <Progress league={league} />}
          <span className="w-32 text-right text-base text-chalk-dim">
            {STATUS_LABELS[league.status]}
          </span>
        </span>
      </Link>
    </li>
  )
}

/**
 * "Una barra di avanzamento degli slot assegnati", plus the two numbers it draws.
 *
 * The count is beside the bar rather than replaced by a percentage: at the start
 * of an auction "18 su 250" is a sentence and "7%" is a shrug. A league with no
 * slots at all — every role set to zero — would divide by zero, so it draws
 * nothing instead.
 */
function Progress({ league }: { league: LeagueSummary }): JSX.Element | null {
  if (league.slotsTotal === 0) return null
  const share = Math.min(1, league.slotsFilled / league.slotsTotal)

  return (
    <span className="flex items-center gap-2">
      {/* A sentence, per the note above, so §4's column role arrives as a class:
          two `Figure` halves around the "su" would be two elements where the
          reader sees one phrase. */}
      <span className="figure-column text-base text-chalk-dim">
        {league.slotsFilled} su {league.slotsTotal}
      </span>
      <span className="block h-1 w-24 rounded-sm bg-pitch-700">
        <span
          className="block h-1 rounded-sm bg-chalk-dim"
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  )
}
