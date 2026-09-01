import { Fragment, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import PriceField from '@/components/PriceField'
import {
  CLASSIC_ROLES,
  MAX_RATING,
  ROLE_LABELS,
  TIERS,
  targetTotals,
  tierOneOverBudget,
} from '@shared/domain'
import { errorMessages } from '@shared/errors'
import type { LeagueDetail, TargetRow } from '@shared/types'

/**
 * Obiettivi, document 2 §4.6: "colonne per ruolo, righe per fascia".
 *
 * The board has six rows and the schema numbers five. The extra one is where the
 * star of §4.4 puts what it marks: adding an objective is one gesture, one
 * gesture cannot also ask which tier, and `target.tier` is nullable for exactly
 * that reason. "Senza fascia" is not a leftover bucket, it is the inbox — and
 * dragging out of it is the act §4.6 describes.
 *
 * Everything here writes through `target.upsert`, which is why the tile can be
 * dragged, re-priced and re-rated without three channels: the service takes the
 * fields that arrive and leaves alone the ones that do not.
 */

type Row = { tier: number | null; label: string }

const ROWS: Row[] = [
  { tier: null, label: 'senza fascia' },
  ...TIERS.map((tier) => ({ tier, label: `fascia ${tier}` })),
]

export default function TargetsView(): JSX.Element {
  const params = useParams()
  const id = window.Number(params.id)
  const queryClient = useQueryClient()

  const league = useQuery({
    queryKey: ['league.get', id],
    queryFn: () => call('league.get', { id }),
    enabled: Number.isInteger(id),
  })
  const targets = useQuery({
    queryKey: ['target.list', id],
    queryFn: () => call('target.list', { leagueId: id }),
    enabled: Number.isInteger(id),
  })

  const [refusal, setRefusal] = useState<string | null>(null)
  /** Remounts the tiles after a refusal — see PriceField, and CLAUDE.md. */
  const [resync, setResync] = useState(0)

  /**
   * Every mutation answers with the whole board, so the cache is written instead
   * of invalidated: a tile dragged to another row lands there once, rather than
   * jumping back and forth between the answer and a refetch.
   */
  function guard(run: () => Promise<TargetRow[]>) {
    return async (): Promise<void> => {
      setRefusal(null)
      try {
        queryClient.setQueryData(['target.list', id], await run())
      } catch (e) {
        setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
        setResync((n) => n + 1)
      }
    }
  }

  const patch = (input: { playerId: number; tier?: number | null; maxPrice?: number | null; rating?: number | null }) =>
    guard(() => call('target.upsert', { leagueId: id, ...input }))()
  const remove = (playerId: number) =>
    guard(() => call('target.delete', { leagueId: id, playerId }))()

  if (league.isPending || targets.isPending) return <Frame>{null}</Frame>

  if (league.isError || targets.isError) {
    const error = league.error ?? targets.error
    return (
      <Frame>
        <p className="text-sm text-taken">
          {error instanceof IpcError ? error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Frame>
    )
  }

  if (league.data === null) {
    return (
      <Frame>
        <p className="text-sm text-chalk-dim">{errorMessages.LEAGUE_MISSING()}</p>
      </Frame>
    )
  }

  return (
    <Frame>
      <Board
        league={league.data}
        targets={targets.data}
        refusal={refusal}
        resync={resync}
        onPatch={patch}
        onRemove={remove}
      />
    </Frame>
  )
}

function Board({
  league,
  targets,
  refusal,
  resync,
  onPatch,
  onRemove,
}: {
  league: LeagueDetail
  targets: TargetRow[]
  refusal: string | null
  resync: number
  onPatch: (input: { playerId: number; tier?: number | null; maxPrice?: number | null; rating?: number | null }) => void
  onRemove: (playerId: number) => void
}): JSX.Element {
  const totals = targetTotals(targets, league.budget)
  const over = tierOneOverBudget(targets, league.budget)

  /**
   * What is being dragged, as a ref rather than as state: a re-render on every
   * `dragover` would fight the browser's own drag image, and nothing on screen
   * depends on it until the drop.
   */
  const dragging = useRef<TargetRow | null>(null)

  if (targets.length === 0) {
    return (
      <>
        <Header league={league} />
        {/* Document 2 §8, word for word: the empty state that points elsewhere,
            because the action does not live on this screen. */}
        <p className="mt-8 text-sm text-chalk-dim">
          Nessun obiettivo. Aggiungi giocatori dalla scheda Giocatori con la stella.
        </p>
      </>
    )
  }

  return (
    <>
      <Header league={league} />

      {over && (
        <p className="mt-2 text-sm text-chalk">
          I tuoi obiettivi di fascia 1 valgono{' '}
          <span className="figures text-credit">{over.total}</span> crediti e il budget è{' '}
          <span className="figures text-credit">{over.budget}</span>.
        </p>
      )}

      {refusal && <p className="mt-2 text-sm text-taken">{refusal}</p>}

      <p className="mt-1 text-sm text-chalk-dim">
        Trascina una tessera per cambiarle fascia, o selezionala e premi da 1 a 5. Lo zero la
        rimanda fra le non collocate.
      </p>

      <div className="mt-4 grid grid-cols-[7rem_repeat(4,minmax(0,1fr))] gap-px bg-line">
        <div className="bg-pitch-900" />
        {CLASSIC_ROLES.map((role) => (
          <div key={role} className="bg-pitch-900 px-2 pb-2">
            <div className="label text-sm">{ROLE_LABELS[role]}</div>
            <div className="text-sm text-chalk-dim">
              <span className="figures">{totals[role].count}</span> ·{' '}
              <span className="figures text-credit">{totals[role].maxPriceTotal}</span> crediti
              {totals[role].budgetShare !== null && (
                <>
                  {' '}
                  ·{' '}
                  <span className="figures">
                    {Math.round(totals[role].budgetShare * 100)}%
                  </span>{' '}
                  del budget
                </>
              )}
            </div>
          </div>
        ))}

        {ROWS.map((row) => (
          <Fragment key={row.label}>
            <div className="flex items-start bg-pitch-800 px-2 py-2">
              <span className="label text-sm text-chalk-dim">{row.label}</span>
            </div>
            {CLASSIC_ROLES.map((role) => (
              <div
                key={role}
                className="min-h-16 space-y-1 bg-pitch-800 p-1"
                onDragOver={(e) => {
                  // Only a tile of this column: a player's role is his, and a
                  // board that let a goalkeeper be dropped among the strikers
                  // would be drawing something the auction cannot honour.
                  const held = dragging.current
                  if (held && held.roleClassic === role && held.tier !== row.tier) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const held = dragging.current
                  dragging.current = null
                  if (held && held.roleClassic === role && held.tier !== row.tier) {
                    onPatch({ playerId: held.playerId, tier: row.tier })
                  }
                }}
              >
                {targets
                  .filter((t) => t.roleClassic === role && (t.tier ?? null) === row.tier)
                  .map((target) => (
                    <Tile
                      key={`${target.playerId}-${resync}`}
                      target={target}
                      onDragStart={() => (dragging.current = target)}
                      onDragEnd={() => (dragging.current = null)}
                      onPatch={onPatch}
                      onRemove={onRemove}
                    />
                  ))}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  )
}

function Header({ league }: { league: LeagueDetail }): JSX.Element {
  return (
    <div>
      <h1 className="text-lg font-medium">Obiettivi</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        {league.name} · budget <span className="figures text-credit">{league.budget}</span>
      </p>
    </div>
  )
}

/**
 * One tile: "nome, squadra, prezzo massimo e rating", per document 2 §4.6.
 *
 * Draggable and focusable both. The drag is what the document asks for; the keys
 * are what makes the same move possible without a mouse, and they cost one
 * handler — the alternative was a tier selector on every tile, which is four
 * lines of chrome on a card meant to be compact.
 */
function Tile({
  target,
  onDragStart,
  onDragEnd,
  onPatch,
  onRemove,
}: {
  target: TargetRow
  onDragStart: () => void
  onDragEnd: () => void
  onPatch: (input: { playerId: number; tier?: number | null; maxPrice?: number | null; rating?: number | null }) => void
  onRemove: (playerId: number) => void
}): JSX.Element {
  return (
    <div
      draggable
      tabIndex={0}
      role="button"
      aria-label={`${target.name}, ${ROLE_LABELS[target.roleClassic]}`}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        /**
         * Solo i tasti battuti sulla tessera, non quelli dei suoi discendenti.
         *
         * Senza questa riga scrivere `40` nel campo del prezzo massimo manda la
         * tessera in fascia 4 e poi fuori fascia: i keydown dell'input risalgono
         * fin qui, la tessera cambia cella, viene smontata a metà digitazione e
         * la cifra non arriva mai a `maxPrice`. Il gesto centrale del §4.6, e la
         * board non si poteva usare.
         */
        if (e.target !== e.currentTarget) return
        if (e.key >= '1' && e.key <= String(TIERS.length)) {
          onPatch({ playerId: target.playerId, tier: window.Number(e.key) })
        }
        if (e.key === '0') onPatch({ playerId: target.playerId, tier: null })
      }}
      className="cursor-grab rounded-md bg-pitch-700 p-1.5 focus:outline focus:outline-chalk-dim"
    >
      <div className="flex items-baseline gap-1">
        <span className="min-w-0 flex-1 truncate text-sm" title={target.name}>
          {target.name}
        </span>
        <span className="label text-sm text-chalk-dim">{target.teamCode ?? target.teamName}</span>
        <button
          className="px-1 text-sm text-chalk-dim hover:text-taken"
          aria-label={`togli ${target.name} dagli obiettivi`}
          title="togli dagli obiettivi"
          onClick={() => onRemove(target.playerId)}
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <Rating
          value={target.rating}
          onChange={(rating) => onPatch({ playerId: target.playerId, rating })}
          name={target.name}
        />
        <PriceField
          value={target.maxPrice}
          label={`prezzo massimo di ${target.name}`}
          onCommit={(maxPrice) => onPatch({ playerId: target.playerId, maxPrice })}
        />
      </div>
    </div>
  )
}

/**
 * Five stars, and the fifth click on the same star clears it.
 *
 * Without that there is no way back from a rating given by mistake, and the
 * schema says `rating` is nullable — a scale you can enter and not leave is a
 * scale that lies about the players nobody has judged yet.
 */
function Rating({
  value,
  onChange,
  name,
}: {
  value: number | null
  onChange: (next: number | null) => void
  name: string
}): JSX.Element {
  return (
    <span className="flex">
      {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((star) => (
        <button
          key={star}
          className={`px-0.5 text-sm leading-none ${
            // Teal e non ambra: un rating non e' denaro, e il documento 2 §2
            // riserva l'ambra ai crediti. Il teal e' il colore che il §2 da'
            // proprio a «e' nella tua lista obiettivi», ed e' quello che usano
            // gia' la stella in tabella e il blocco nel pannello.
            value !== null && star <= value ? 'text-target' : 'text-line hover:text-chalk-dim'
          }`}
          aria-label={`${star} su ${MAX_RATING} a ${name}`}
          title={`${star} su ${MAX_RATING}`}
          onClick={() => onChange(value === star ? null : star)}
        >
          ★
        </button>
      ))}
    </span>
  )
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="min-w-0 flex-1 overflow-auto p-6">{children}</div>
}
