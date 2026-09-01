import { useCallback, useEffect, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import Onboarding from './features/data/Onboarding'
import Scaffold from './routes/Scaffold'
import { call } from './lib/ipc'

/**
 * HashRouter, never BrowserRouter: the packaged app is loaded from a file://
 * URL, where there is no server to resolve path-based routes against.
 */
export default function App(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Start />} />
      </Routes>
    </HashRouter>
  )
}

/**
 * Document 2 §4.1: onboarding "compare solo al primo avvio, o quando il database
 * non ha nessuna stagione". So the question is asked of the database, not
 * remembered as a flag — a flag would keep an app whose data was cleared out
 * sitting on an empty players view with no way back to the import.
 */
function Start(): JSX.Element | null {
  const [seasons, setSeasons] = useState<number | null>(null)

  const count = useCallback(() => {
    call('dataset.list')
      .then((list) => setSeasons(list.length))
      // A failing channel is not "no seasons": showing onboarding here would
      // invite an import that cannot work either. The scaffold reports it.
      .catch(() => setSeasons(1))
  }, [])

  useEffect(count, [count])

  if (seasons === null) return null
  return seasons === 0 ? <Onboarding onDone={count} /> : <Scaffold />
}
