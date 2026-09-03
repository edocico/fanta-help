import { useQuery } from '@tanstack/react-query'
import { call, IpcError } from '@/lib/ipc'
import { credits, errorMessages, teamsWithFreeSlots } from '@shared/errors'
import type { AuctionLogEntry, AuctionState } from '@shared/types'

/**
 * `Ctrl/Cmd+H`, document 2 §6: "cronologia operazioni".
 *
 * The append-only register of document 1 §3, and **read-only**. §5 says of it
 * "si trova la riga e si modifica o si elimina", but §4.10 gives that job to the
 * Revisione screen — a table of every purchase with price and team editable in
 * place — and the IPC has no channel that could do it here: `auction.undo`
 * removes the *last* purchase and nothing else. Writing one now would be putting
 * T16 inside T14, so this panel says where the correction lives instead of
 * pretending to offer it.
 *
 * Not a modal, per §1: it is a panel over the right-hand side, `Esc` closes it,
 * and the auction underneath goes on being usable — including `Ctrl/Cmd+Z`,
 * which is the correction that *does* live here.
 */
export default function History({
  leagueId,
  teams,
  onClose,
}: {
  leagueId: number
  teams: AuctionState['teams']
  onClose: () => void
}): JSX.Element {
  const history = useQuery({
    queryKey: ['auction.history', leagueId],
    queryFn: () => call('auction.history', { leagueId }),
  })

  return (
    <aside className="flex w-96 max-w-full shrink-0 flex-col border-l border-line bg-pitch-800">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="label text-xs text-chalk-dim">Cronologia</h2>
        <button className="label text-xs text-chalk-dim hover:text-chalk" onClick={onClose}>
          Chiudi ⎋
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {history.isError && (
          <p className="p-3 text-sm text-taken">
            {history.error instanceof IpcError ? history.error.message : errorMessages.IPC_UNAVAILABLE()}
          </p>
        )}

        {history.data?.length === 0 && (
          // Document 2 §8, word for word.
          <p className="p-3 text-sm text-chalk-dim">Nessuna operazione ancora.</p>
        )}

        <ul>
          {history.data?.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2 border-b border-line px-3 py-1.5 text-sm">
              {/* A timestamp is not a figure — no `Figure` here, and no colour.
                  `figure-column` all the same: it is the one thing in this
                  panel that stands in a column, and "3 set, 09:07" over
                  "12 set, 23:41" only reads as a column if the digits are
                  tabular. */}
              <span className="figure-column shrink-0 text-xs text-chalk-dim">
                {when(entry.createdAt)}
              </span>
              <span className="min-w-0 flex-1">{describe(entry, teams)}</span>
            </li>
          ))}
        </ul>
      </div>

      <footer className="border-t border-line px-3 py-2 text-xs text-chalk-dim">
        Ctrl/Cmd+Z annulla l’ultimo acquisto. Per correggerne uno più vecchio, chiudi l’asta e
        apri la revisione.
      </footer>
    </aside>
  )
}

const clock = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function when(at: number): string {
  return clock.format(new Date(at))
}

/**
 * One log line, in Italian.
 *
 * `payload` is a JSON string the service wrote, and the contract is explicit
 * that "the renderer shows it, nothing reads it back as truth". So every read
 * here is defensive and every failure falls through to the raw text: a register
 * written by an older version of the app must still be legible, and a line that
 * threw would take the whole panel with it.
 */
function describe(entry: AuctionLogEntry, teams: AuctionState['teams']): string {
  const p = parse(entry.payload)
  if (p === null) return `${entry.action} ${entry.payload}`

  const player = typeof p.player === 'string' ? p.player : null
  const team = typeof p.team === 'string' ? p.team : null
  const price = typeof p.price === 'number' ? p.price : null

  switch (entry.action) {
    case 'purchase.create':
      return player && team && price !== null
        ? `${player} → ${team}, ${credits(price)}`
        : entry.payload
    case 'purchase.undo':
      return player && team && price !== null
        ? `annullato: ${player} → ${team}, ${credits(price)}`
        : entry.payload
    case 'auction.start':
      return typeof p.teams === 'number' ? `asta aperta con ${p.teams} squadre` : 'asta aperta'
    case 'auction.close':
      // The same fragment the close confirmation uses, from shared/errors.ts.
      // Written separately, the two had already drifted apart inside one task.
      if (typeof p.incomplete !== 'number') return 'asta chiusa'
      if (p.incomplete === 0) return 'asta chiusa, tutte le rose complete'
      return `asta chiusa, ${teamsWithFreeSlots(p.incomplete)}`
    case 'turn.set': {
      if (p.fantaTeamId === null) return 'turno tolto a tutti'
      const named = teams.find((t) => t.id === p.fantaTeamId)
      return named ? `turno a ${named.name}` : 'turno cambiato'
    }
    default:
      return `${entry.action} ${entry.payload}`
  }
}

function parse(payload: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
