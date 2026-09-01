import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from './lib/query'
import AppShell from './components/AppShell'
import Onboarding from './features/data/Onboarding'
import Home from './features/leagues/Home'
import LeagueView from './features/leagues/LeagueView'
import Wizard from './features/leagues/Wizard'
import PlansView from './features/plans/PlansView'
import PlayersView from './features/players/PlayersView'
import TargetsView from './features/targets/TargetsView'
import { call } from './lib/ipc'

/**
 * HashRouter, never BrowserRouter: the packaged app is loaded from a file://
 * URL, where there is no server to resolve path-based routes against.
 *
 * The routes are the map of document 2 §3: the home lists the leagues, the
 * wizard makes one, the league opens on its teams, and the players view is
 * reachable from anywhere because it does not belong to a league. Everything
 * hangs off one layout route, so the sidebar is mounted once and does not
 * remount — and its league selector does not flicker — when the view changes.
 */
export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Start />}>
            <Route path="/" element={<Home />} />
            {/* Before the parametric one for a reader; the router ranks it first anyway. */}
            <Route path="/lega/nuova" element={<Wizard />} />
            <Route path="/lega/:id" element={<LeagueView />} />
            <Route path="/lega/:id/obiettivi" element={<TargetsView />} />
            <Route path="/lega/:id/piani" element={<PlansView />} />
            <Route path="/giocatori" element={<PlayersView />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}

/**
 * Document 2 §4.1: onboarding "compare solo al primo avvio, o quando il database
 * non ha nessuna stagione". So the question is asked of the database, not
 * remembered as a flag — a flag would keep an app whose data was cleared out
 * sitting on an empty players view with no way back to the import.
 *
 * It replaces the whole frame rather than appearing inside it: a sidebar of
 * league sections around a screen that exists because there is no data yet would
 * be offering rooms that lead nowhere.
 */
function Start(): JSX.Element | null {
  // The same query the players view and the wizard run, on the same key: one
  // call, one cache entry, one answer. Read twice through `useState` and
  // `useEffect` the two would drift apart the day something reimports.
  const seasons = useQuery({ queryKey: ['dataset.list'], queryFn: () => call('dataset.list') })

  if (seasons.isPending) return null
  // A failing channel is not "no seasons": showing the onboarding here would
  // invite an import that cannot work either. The views inside report it.
  if (!seasons.isError && seasons.data.length === 0) {
    return <Onboarding onDone={() => void seasons.refetch()} />
  }
  return <AppShell />
}
