import { HashRouter, Route, Routes } from 'react-router-dom'
import Scaffold from './routes/Scaffold'

/**
 * HashRouter, never BrowserRouter: the packaged app is loaded from a file://
 * URL, where there is no server to resolve path-based routes against.
 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Scaffold />} />
      </Routes>
    </HashRouter>
  )
}
