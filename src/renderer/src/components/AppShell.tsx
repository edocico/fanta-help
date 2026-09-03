import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { call } from '@/lib/ipc'
import { useDense, useOpenLeagueId } from '@/lib/league'
import Reference from '@/components/Reference'
import { useLeagueStore } from '@/stores/league'
import type { LeagueSummary } from '@shared/types'

/**
 * The frame of document 2 §3: "barra laterale stretta a sinistra con le sezioni
 * della lega attiva, selettore lega in alto".
 *
 * The sections that are not built yet are listed and inert rather than hidden.
 * The map of views is the shape of the app, and a sidebar that grows an entry per
 * task would make each one look like a new idea instead of a room that was
 * always there. They say what they are, the way the download half of the
 * onboarding does.
 *
 * "Durante l'asta la barra si ritrae e la vista occupa tutto", §3, is the one
 * behaviour of this file that is conditional. It retracts to a rail rather than
 * disappearing — that is what the sentence says, and a bar that vanished would
 * leave the auction with no way out of itself on the one evening nobody has time
 * to look for one.
 *
 * The condition is the *state* of the league and not only the route: the same
 * URL shows "Apri l'asta" before it starts and the board afterwards, and
 * retracting for the first would hide the navigation from a screen with a single
 * button on it. The status is read off `league.list`, which is already loaded
 * here — no second call, and it is marked stale by every auction mutation.
 */

type Section = { path: string; label: string; ready: boolean }

const SECTIONS: Section[] = [
  { path: '', label: 'Squadre', ready: true },
  { path: 'obiettivi', label: 'Obiettivi', ready: true },
  { path: 'piani', label: 'Piani', ready: true },
  { path: 'asta', label: 'Asta', ready: true },
  { path: 'revisione', label: 'Revisione', ready: true },
  { path: 'resoconto', label: 'Resoconto', ready: true },
]

export default function AppShell(): JSX.Element {
  const leagues = useQuery({ queryKey: ['league.list'], queryFn: () => call('league.list') })
  const activeLeagueId = useLeagueStore((s) => s.activeLeagueId)
  const setActive = useLeagueStore((s) => s.setActiveLeague)

  /**
   * With no league in the route and none chosen yet, the active one is the first
   * in the list — which `league.list` orders by last touched, so it is the league
   * being prepared. Without this the selector would *show* that league (a select
   * with no matching value falls back to its first option) while the sections
   * under it stayed empty, which is a picker disagreeing with itself.
   */
  useEffect(() => {
    const first = leagues.data?.[0]
    if (activeLeagueId === null && first) setActive(first.id)
  }, [leagues.data, activeLeagueId, setActive])

  const openId = useOpenLeagueId()
  const running = useDense()

  return (
    <div className="flex h-screen bg-pitch-900 text-chalk">
      {running ? (
        <nav className="flex w-10 shrink-0 flex-col items-center border-r border-line bg-pitch-800 py-3">
          <NavLink
            to={`/lega/${openId}`}
            className="rounded-md border border-line px-2 py-1 text-sm leading-none text-chalk-dim hover:text-chalk"
            title="torna alla lega"
            aria-label="torna alla lega"
          >
            ←
          </NavLink>
        </nav>
      ) : (
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-line bg-pitch-800 p-3">
          <LeaguePicker leagues={leagues.data ?? []} />
          <LeagueSections />
          <hr className="my-2 border-line" />
          <Entry to="/giocatori" label="Giocatori" />
        </nav>
      )}

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* `?` from document 2 §6, which says "ovunque" — so it hangs off the frame
          and not off any one view. */}
      <Reference />
    </div>
  )
}


function LeaguePicker({ leagues }: { leagues: LeagueSummary[] }): JSX.Element {
  const navigate = useNavigate()
  const setActive = useLeagueStore((s) => s.setActiveLeague)
  const openId = useOpenLeagueId()

  return (
    <div className="flex items-center gap-1">
      <select
        className="min-w-0 flex-1 truncate rounded-md border border-line bg-pitch-900 px-2 py-1.5 text-sm"
        value={openId ?? ''}
        disabled={leagues.length === 0}
        onChange={(e) => {
          const id = Number(e.target.value)
          setActive(id)
          navigate(`/lega/${id}`)
        }}
        aria-label="lega attiva"
      >
        {leagues.length === 0 && <option value="">nessuna lega</option>}
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <NavLink
        to="/lega/nuova"
        className="rounded-md border border-line px-2 py-1.5 text-sm leading-none text-chalk-dim hover:text-chalk"
        title="Nuova lega"
        aria-label="Nuova lega"
      >
        +
      </NavLink>
    </div>
  )
}

function LeagueSections(): JSX.Element {
  const openId = useOpenLeagueId()

  if (openId === null) {
    return (
      <p className="px-2 py-3 text-sm text-chalk-dim">
        Crea una lega per preparare l’asta.
      </p>
    )
  }

  return (
    <>
      {SECTIONS.map((section) =>
        section.ready ? (
          <Entry
            key={section.label}
            to={`/lega/${openId}${section.path ? `/${section.path}` : ''}`}
            label={section.label}
            end
          />
        ) : (
          <span
            key={section.label}
            className="px-2 py-1.5 text-sm text-chalk-dim opacity-40"
            aria-disabled="true"
            title="Non ancora disponibile"
          >
            {section.label}
          </span>
        ),
      )}
    </>
  )
}

function Entry({ to, label, end }: { to: string; label: string; end?: boolean }): JSX.Element {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md px-2 py-1.5 text-sm ${
          isActive ? 'bg-pitch-700 text-chalk' : 'text-chalk-dim hover:text-chalk'
        }`
      }
    >
      {label}
    </NavLink>
  )
}
