import { useEffect, useState } from 'react'
import { fail, type Result } from '@shared/errors'
import type { AppInstance } from '@shared/types'

/**
 * The whole packaging spike on one screen: if these values appear in an
 * installed package, better-sqlite3 survived asar, the IPC pipe works and the
 * pragmas were applied. T2 replaces this view.
 */
export default function App() {
  const [state, setState] = useState<Result<AppInstance> | null>(null)

  useEffect(() => {
    window.api
      .invoke('app.instance')
      .then((res) => setState(res as Result<AppInstance>))
      .catch((e: unknown) => setState(fail('IPC_UNAVAILABLE', String(e))))
  }, [])

  return (
    <main>
      <h1>fanta help</h1>
      <p className="lede">spike di packaging · T1</p>

      {state === null && <p className="lede">lettura…</p>}

      {state?.ok === false && (
        <div className="error">
          <p>{state.error.message}</p>
          <p>
            <code>{state.error.code}</code>
          </p>
        </div>
      )}

      {state?.ok === true && (
        <dl>
          <dt>versione</dt>
          <dd>{state.data.version}</dd>

          <dt>database</dt>
          <dd>{state.data.databasePath}</dd>

          <dt>avvii registrati</dt>
          <dd>{state.data.bootCount}</dd>

          <dt>ultimo avvio</dt>
          <dd>{state.data.bootedAt}</dd>

          <dt>foreign_keys</dt>
          <dd>{state.data.foreignKeys ? 'on' : 'off'}</dd>
        </dl>
      )}
    </main>
  )
}
