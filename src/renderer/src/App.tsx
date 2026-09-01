import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from './lib/query'
import Onboarding from './features/data/Onboarding'
import PlayersView from './features/players/PlayersView'
import { call } from './lib/ipc'

/**
 * HashRouter, never BrowserRouter: the packaged app is loaded from a file://
 * URL, where there is no server to resolve path-based routes against.
 */
export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Start />} />
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
 */
function Start(): JSX.Element | null {
  // The same query the players view runs, on the same key: one call, one cache
  // entry, one answer. Read twice through `useState` and `useEffect` the two
  // would drift apart the day something reimports outside the onboarding.
  const seasons = useQuery({ queryKey: ['dataset.list'], queryFn: () => call('dataset.list') })

  if (seasons.isPending) return null
  // A failing channel is not "no seasons": showing the onboarding here would
  // invite an import that cannot work either. The players view reports it.
  if (seasons.isError) return <PlayersView />
  return seasons.data.length === 0 ? <Onboarding onDone={() => void seasons.refetch()} /> : <PlayersView />
}
