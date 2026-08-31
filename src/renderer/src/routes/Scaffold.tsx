import { useEffect, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fail, type Result } from '@shared/errors'
import type { AppInstance } from '@shared/types'

/**
 * The visual scaffold of T2: one screen whose only job is to put the tokens of
 * document 2 §2 under load. The data is invented. T9 replaces this with the real
 * Giocatori view, built from document 2 §4.4.
 */

type Row = {
  name: string
  role: 'P' | 'D' | 'C' | 'A'
  team: string
  /** Team colours come from the league setup in the real app. Placeholders here. */
  teamColor: string
  price: number
  state?: 'taken' | 'target'
}

const ROWS: Row[] = [
  { name: 'Ferraro', role: 'A', team: 'Inter', teamColor: '#0068A8', price: 178 },
  { name: 'Belloni', role: 'A', team: 'Napoli', teamColor: '#12A0D7', price: 154, state: 'target' },
  { name: 'Zanetti', role: 'C', team: 'Atalanta', teamColor: '#1D71B8', price: 96 },
  { name: 'Marchetti', role: 'C', team: 'Roma', teamColor: '#8E1F2F', price: 88, state: 'taken' },
  { name: 'De Santis', role: 'C', team: 'Lazio', teamColor: '#87D8F7', price: 61 },
  { name: 'Rinaldi', role: 'D', team: 'Juventus', teamColor: '#D9D9D9', price: 34, state: 'target' },
  { name: 'Amato', role: 'D', team: 'Fiorentina', teamColor: '#592C82', price: 19 },
  { name: 'Guerrieri', role: 'P', team: 'Milan', teamColor: '#FB090B', price: 12 },
]

export default function Scaffold() {
  const [state, setState] = useState<Result<AppInstance> | null>(null)

  useEffect(() => {
    window.api
      .invoke('app.instance')
      .then((res) => setState(res as Result<AppInstance>))
      .catch((e: unknown) => setState(fail('IPC_UNAVAILABLE', String(e))))
  }, [])

  return (
    <div className="min-h-screen bg-pitch-900 text-chalk">
      <header className="border-b border-line px-6 py-4">
        {/* Sentence case: this is a view title. Column headings stay lowercase. */}
        <h1 className="text-base font-medium">Fanta Help</h1>
        <p className="label mt-0.5 text-sm text-chalk-dim">
          impalcatura visiva · dati inventati
        </p>
      </header>

      <main className="px-6 py-5">
        <Table>
          <TableHeader>
            <TableRow className="border-line hover:bg-transparent">
              <TableHead className="label h-9 text-chalk-dim">giocatore</TableHead>
              <TableHead className="label h-9 w-16 text-chalk-dim">ruolo</TableHead>
              <TableHead className="label h-9 text-chalk-dim">squadra</TableHead>
              <TableHead className="label h-9 w-32 text-right text-chalk-dim">
                quotazione
              </TableHead>
              <TableHead className="label h-9 w-32 text-chalk-dim">stato</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {ROWS.map((row, i) => (
              <TableRow
                key={row.name}
                // Alternating rows use pitch-700, per document 2. Rows keep a
                // square corner: the 4px radius belongs to controls only.
                className={`h-9 rounded-none border-line ${i % 2 === 1 ? 'bg-pitch-700' : ''}`}
              >
                <TableCell
                  className={`py-0 font-medium ${row.state === 'taken' ? 'text-chalk-dim' : ''}`}
                >
                  {row.name}
                </TableCell>

                <TableCell className="py-0 text-chalk-dim">{row.role}</TableCell>

                <TableCell className="py-0">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.teamColor }}
                    />
                    {row.team}
                  </span>
                </TableCell>

                {/* Amber is reserved for money. Nothing else uses this colour. */}
                <TableCell className="figures py-0 text-right text-credit">
                  {row.price}
                </TableCell>

                <TableCell className="py-0">
                  {row.state === 'taken' && <span className="text-taken">preso</span>}
                  {row.state === 'target' && <span className="text-target">obiettivo</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </main>

      {/* Kept from T1: proves the IPC pipe still answers inside the package. */}
      <footer className="border-t border-line px-6 py-3 text-sm text-chalk-dim">
        {state?.ok === true && (
          <span>
            versione {state.data.version} · avvii{' '}
            <span className="figures">{state.data.bootCount}</span>
          </span>
        )}
        {/* The message comes from shared/errors.ts, never written here: an error
            has to say what happened and what to do, and a component that invents
            its own copy says neither. */}
        {state?.ok === false && <span className="text-taken">{state.error.message}</span>}
      </footer>
    </div>
  )
}
