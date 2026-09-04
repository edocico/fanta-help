import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Header,
  type RowData,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { call, IpcError } from '@/lib/ipc'
import type { FigureKind } from '@/lib/format'
import { isMod, isTypingTarget } from '@/lib/keys'
import { cn } from '@/lib/utils'
import Abbr from '@/components/Abbr'
import Figure from '@/components/Figure'
import FilterChip from '@/components/FilterChip'
import Glyph from '@/components/Glyph'
import RoleBadge from '@/components/RoleBadge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeadCell,
  DataTableHeadRow,
  DataTableRow,
} from '@/components/DataTable'
import type { Abbr as AbbrName } from '@shared/glossary'
import { useLeagueStore } from '@/stores/league'
import { usePlayersStore, type Filters } from '@/stores/players'
import { haystack, search as fuzzy } from './search'
import PlayerDetail from './PlayerDetail'
import type { Objectives } from '@/features/targets/objectives'
import {
  bonusIndex,
  concededPerMatch,
  CLASSIC_ROLES,
  normalizeName,
  cleanSheetRate,
  MANTRA_ROLES,
  MATCHDAYS,
  MAX_RATING,
  ROLE_LABELS,
  minutesPerMatch,
  expectedPrices,
  malusRate,
  pastWindow,
  playerScore,
  reliability,
  startShare,
  weightsFor,
  type ClassicRole,
  type PricedPlayer,
} from '@shared/domain'
import { errorMessages, notices } from '@shared/errors'
import type { PlayerRow, SeasonStats, TargetRow } from '@shared/types'

/**
 * Giocatori, document 2 §4.4: the view the pre-auction phase is spent in.
 *
 * Everything filters in memory. The whole season arrives once and search,
 * chips and sorting never touch the main process again — which is what the
 * completion criterion of T9 asks for, "la ricerca risponde mentre digiti senza
 * attesa percepibile su seicento righe", and what a round trip per keystroke
 * cannot deliver.
 *
 * Several things document 2 asks for are not here, and their absence is the
 * document's own rule rather than an omission: the colour band of the buying
 * team, the star that adds to the targets, and the expected price all need a
 * league, which arrives in T11. §4.4 says of the FBref columns "le nasconde
 * invece di mostrare quindici trattini"; the same applies to a column that can
 * only ever be empty.
 */

/*
 * I cinque formattatori e `show()` stavano qui, e identici in fondo a
 * `PlayerDetail.tsx`: 667 byte per parte, confrontati byte per byte prima di
 * accorparli. Ora stanno in `lib/format.ts`, che è anche dove `Figure` li
 * legge — e i commenti che dicono *perché* una quotazione non ha decimali sono
 * andati con loro, perché quelli sono la specifica.
 */

/**
 * Which columns hold a figure, so the header, the cell and the tabular numerals
 * agree without repeating the list three times.
 *
 * Declared through TanStack's own `meta` rather than a lookup table beside it:
 * a column added without a `meta` simply reads as text, while a second list
 * would go stale the moment someone adds a column and forgets it.
 *
 * `abbr` joined it in T23 and carries the same idea one step further: a heading
 * that is an abbreviation says so once, and the `<th>` turns it into an `Abbr`
 * with its popover. The string is never written twice — `num()` fills both
 * `header` and `abbr` from its one argument — because two copies of `FM` are
 * exactly how a column heading and its glossary entry come apart.
 */
declare module '@tanstack/react-table' {
  // The two parameters are TanStack's own; the augmentation has to repeat them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean
    abbr?: AbbrName
  }
}

const columnHelper = createColumnHelper<Row>()

type Row = PlayerRow & { season: SeasonStats | undefined }

/** Document 2 §4.4: a preset for whoever does not want to think about it. */
const PV_PRESET = 25

export default function PlayersView(): JSX.Element {
  const { query, filters, sorting, setQuery, patchFilters, setSorting, reset } = usePlayersStore()
  const chosenSeason = usePlayersStore((s) => s.seasonId)
  const chosenStatsSeason = usePlayersStore((s) => s.statsSeason)
  const setSeasonId = usePlayersStore((s) => s.setSeasonId)
  const setStatsSeason = usePlayersStore((s) => s.setStatsSeason)
  const selectedPlayerId = usePlayersStore((s) => s.selectedPlayerId)
  const select = usePlayersStore((s) => s.select)

  /**
   * `Ctrl/Cmd+K` and `/` — document 2 §6, column "dove": **ovunque**.
   *
   * Written here as well as in the auction panel because the table means it: the
   * two rows are the only ones scoped to everywhere, and the `?` reference lists
   * them that way. Left in the auction alone they would have been two more false
   * lines in the panel that is read once a year, by somebody for whom nothing
   * else has worked.
   *
   * `/` yields to any field being typed into — the same rule §6 states for it —
   * while `Ctrl/Cmd+K` does not, because it cannot be typed by accident.
   */
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const wanted =
        (isMod(e) && e.key.toLowerCase() === 'k') || (e.key === '/' && !isTypingTarget(e.target))
      if (!wanted) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const seasonsQuery = useQuery({
    queryKey: ['dataset.list'],
    queryFn: () => call('dataset.list'),
  })
  const seasons = seasonsQuery.data ?? []

  /**
   * The league that is open, if one is: document 2 §9 decides that "la vista
   * Giocatori mostra la stagione della lega aperta, o la più recente importata".
   * Cached under the same key the league view uses, so opening a league and
   * coming here costs nothing.
   */
  const activeLeagueId = useLeagueStore((s) => s.activeLeagueId)
  const leagueQuery = useQuery({
    queryKey: ['league.get', activeLeagueId],
    queryFn: () => call('league.get', { id: activeLeagueId as number }),
    enabled: activeLeagueId !== null,
  })

  /**
   * The objectives of that league, which is what the star of document 2 §4.4
   * writes into — "la stella aggiunge agli obiettivi della lega attiva".
   *
   * Same key as the board of T12, so marking a player here and opening Obiettivi
   * costs no round trip and the two can never show different tiles.
   */
  const queryClient = useQueryClient()
  const targetsQuery = useQuery({
    queryKey: ['target.list', activeLeagueId],
    queryFn: () => call('target.list', { leagueId: activeLeagueId as number }),
    enabled: activeLeagueId !== null,
  })

  const [starRefusal, setStarRefusal] = useState<string | null>(null)
  /** Rimonta stella e blocco obiettivo dopo un rifiuto: senza, il campo resta
   *  a mostrare il valore appena respinto, che e' la seconda meta' della
   *  trappola del CLAUDE.md. */
  const [starResync, setStarResync] = useState(0)

  /**
   * The star and the objective block of §4.5 write through the same two calls.
   *
   * `null` when no league is open, and that is what hides the column rather than
   * disabling it: §4.4's own rule for the FBref columns — "le nasconde invece di
   * mostrare quindici trattini" — and a star that cannot add to anything is
   * exactly such a column.
   */
  const objectives = useMemo(() => {
    if (activeLeagueId === null) return null
    const byPlayer = new Map((targetsQuery.data ?? []).map((t) => [t.playerId, t]))

    async function write(run: () => Promise<TargetRow[]>): Promise<void> {
      setStarRefusal(null)
      try {
        queryClient.setQueryData(['target.list', activeLeagueId], await run())
      } catch (e) {
        setStarRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
        setStarResync((n) => n + 1)
      }
    }

    return {
      of: (playerId: number) => byPlayer.get(playerId) ?? null,
      patch: (input: {
        playerId: number
        tier?: number | null
        maxPrice?: number | null
        rating?: number | null
        note?: string | null
      }) => void write(() => call('target.upsert', { leagueId: activeLeagueId, ...input })),
      remove: (playerId: number) =>
        void write(() => call('target.delete', { leagueId: activeLeagueId, playerId })),
    }
  }, [activeLeagueId, targetsQuery.data, queryClient])

  /**
   * Derived, not stored: the store holds an override and null means "whatever
   * the data says". Writing the default back into the store on arrival would be
   * an effect that reacts to its own result, and the two would disagree for one
   * render every time the query refetched.
   *
   * Three sources in the order document 2 §9 puts them: what was picked here,
   * then the open league's season, then the most recent import.
   */
  const seasonId = chosenSeason ?? leagueQuery.data?.seasonId ?? seasons.at(-1)?.id ?? null

  const listQuery = useQuery({
    // Channel and input, as document 3 §4 spells the convention.
    queryKey: ['player.list', { seasonId }],
    queryFn: () => call('player.list', { seasonId: seasonId as string }),
    enabled: seasonId !== null,
  })
  const list = listQuery.data ?? null
  const statsSeason = chosenStatsSeason ?? list?.defaultStatsSeason ?? null

  const error = [seasonsQuery.error, listQuery.error].find(Boolean)

  const index = useMemo(() => haystack(list?.players ?? []), [list])

  /**
   * The score and the expected price of document 1 §6.
   *
   * Over the **whole listone**, not the filtered rows: an expected price is a
   * share of a market, and filtering by role takes credits away from nobody —
   * computed on the filter, a defender would inherit the attack's budget the
   * moment attackers left the view. Recomputed only when the listone or the
   * league changes, not on every keystroke of the search.
   *
   * Every term reads the **recent past**, not the season chosen in the picker:
   * that one is a view, this is a judgement, and in September the season being
   * auctioned carries two matchdays.
   */
  const evaluation = useMemo(() => {
    const players = list?.players
    const season = list?.seasonId
    if (!players || !season) return null

    const league = leagueQuery.data ?? null
    const scores = new Map<number, number | null>()
    const priced: PricedPlayer[] = []

    for (const player of players) {
      const past = pastWindow(player.stats, season)
      const role = player.roleClassic as ClassicRole
      const score = playerScore(
        {
          expectedFantaAvg: past?.fantaAvg ?? null,
          reliability: reliability(past?.matchesRated ?? null),
          bonusIndex: bonusIndex(past?.fantaAvg ?? null, past?.avgVote ?? null),
          startShare: startShare(past?.starts ?? null, past?.matchesPlayed ?? null),
          malusRate: malusRate(
            past?.yellowCards ?? null,
            past?.redCards ?? null,
            past?.ownGoals ?? null,
            past?.matchesRated ?? null,
          ),
          concededPerMatch: concededPerMatch(past?.goalsConceded ?? null, past?.matchesRated ?? null),
        },
        weightsFor(role, league?.defenseModifier ?? false),
      )
      scores.set(player.id, score)
      priced.push({ id: player.id, role, score, quotazione: player.qtClassicCurrent })
    }

    return {
      scores,
      /**
       * Whether anybody has a score at all.
       *
       * False on a database seeded from the XLSX alone, which carries the
       * quotazioni and no statistics: there the column would be empty for all
       * 524, which is the column §4.4 says to hide rather than print six hundred
       * dashes. Not a hypothetical — it is how the app looks when it is first
       * installed, before the dataset arrives.
       */
      hasScores: [...scores.values()].some((v) => v !== null),
      // With no league there is no market to normalise on: no budget, no teams,
      // no slots. The column goes, the way FBref's do when the optional stage
      // never ran.
      prices: league
        ? expectedPrices(priced, {
            budget: league.budget,
            teams: league.teamCount,
            slots: league.slots,
            minBid: league.minBid,
          })
        : null,
    }
  }, [list, leagueQuery.data])

  const rows = useMemo<Row[]>(() => {
    const found = fuzzy(index, query)
    return found
      .map((player) => ({
        ...player,
        season: statsSeason ? player.stats[statsSeason] : undefined,
      }))
      .filter((row) => {
        if (filters.role && row.roleClassic !== filters.role) return false
        if (filters.team && row.teamName !== filters.team) return false
        if (filters.mantra && !row.rolesMantra.includes(filters.mantra)) return false
        if (filters.penaltyTakers && !row.penaltyTaker) return false
        if (filters.minPv !== null && (row.season?.matchesRated ?? 0) < filters.minPv) return false
        return true
      })
  }, [index, query, filters, statsSeason])

  /**
   * The FBref columns follow the season whose numbers are on screen, not the one
   * the listone belongs to.
   *
   * `season.has_fbref` says the optional stage ran for the imported dataset; it
   * says nothing about the season picked in the selector. Reading the flag alone
   * would put three columns of dashes on screen the moment someone looks back at
   * a year FBref does not cover — which is exactly the "quindici trattini" that
   * §4.4 hides them to avoid, and the rule the omissions in this view rest on.
   *
   * A conjunction rather than the data check alone, so the flag documents 1 §6
   * and 2 §4.4 both name by hand stays the outer gate. The two can only disagree
   * one way — flag off, data present — and an import replaces the statistics of
   * every identity it carries, so a dataset built without FBref leaves no FBref
   * numbers behind to be hidden.
   */
  const showFbref = useMemo(
    () =>
      (list?.hasFbref ?? false) &&
      statsSeason !== null &&
      (list?.players ?? []).some((p) => p.stats[statsSeason]?.matchesPlayed != null),
    [list, statsSeason],
  )

  /**
   * Looked up in the whole listone rather than among the filtered rows: typing
   * in the search box while a panel is open would otherwise close it the moment
   * the name stops matching, which is the opposite of what the reader is doing —
   * looking one player up while keeping another on screen.
   */
  const selected = useMemo(
    () => (list?.players ?? []).find((p) => p.id === selectedPlayerId) ?? null,
    [list, selectedPlayerId],
  )

  const columns = useMemo(
    () => buildColumns(showFbref, objectives, evaluation),
    [showFbref, objectives, evaluation],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    // Two states per column, not three. The third click of the default cycle
    // removes the sort entirely and drops the table back to insertion order —
    // and since document 2 §4.4 names "quotazione decrescente" as *the* default,
    // there would be nothing on screen to get back to it.
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const scroller = useRef<HTMLDivElement>(null)
  const sorted = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scroller.current,
    // Measured in the running app with `getBoundingClientRect()`, not guessed —
    // and re-measured after T23, because T23 is what changed the answer.
    //
    // It used to be 59, and 59 was right at the time: nothing declared a row
    // height, every player in a real listone carries at least one Mantra role, so
    // the name cell was two lines and the row grew to fit them. `DataTableRow`
    // now pins the row at `h-10`, the §5 forty, and the Mantra line went from an
    // inherited 16px to `text-micro`. Measured: **40.00px**, on all 40 rows
    // sampled at the top of the list and 60% down, with no second value.
    //
    // Leaving 59 was not cosmetic. A wrong estimate makes the spacers lie about
    // the total: with 524 rows the scroller claimed 30,321px against a true
    // 20,960, so the scrollbar shrank as you dragged it and the bottom of the
    // list moved out from under the pointer. Only the ~20 mounted rows get
    // corrected by `measureElement`, so the lie is repaired a screenful at a
    // time, in front of you.
    estimateSize: () => 40,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 12,
  })

  const teams = useMemo(
    () => [...new Set((list?.players ?? []).map((p) => p.teamName))].sort(),
    [list],
  )

  if (error) {
    return (
      <Shell>
        <p className="p-6 text-base text-blocking">
          {error instanceof IpcError ? error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Shell>
    )
  }

  if (!list) {
    return (
      <Shell>
        <p className="p-6 text-base text-fg-muted">Carico i giocatori…</p>
      </Shell>
    )
  }

  const active = describeFilters(filters, query)

  return (
    <Shell>
      <header className="border-b border-line px-6 py-3">
        <div className="flex items-baseline gap-4">
          <input
            ref={searchRef}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-panel px-3 py-1.5 text-base placeholder:text-fg-muted"
            placeholder="Cerca un giocatore"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {/* Un numero dentro una frase, che `Figure` non può avvolgere: non è una
              cifra in un elemento suo, è una parola su tre. Prende la classe del
              ruolo — cifre tabulari, così «524 giocatori» e «12 di 524» non
              ballano mentre si digita — e non il componente. */}
          <span className="figure-column shrink-0 text-base text-fg-muted">
            {sorted.length === list.players.length
              ? `${list.players.length} giocatori`
              : `${sorted.length} di ${list.players.length}`}
          </span>
        </div>

        {/* Un rifiuto della stella o del blocco obiettivo. Sta qui in alto e non
            sulla riga: la riga può essere stata portata via da un filtro o dalla
            ricerca nel frattempo, e un messaggio che scompare con essa non è
            stato letto da nessuno. */}
        {starRefusal && <p className="mt-2 text-base text-blocking">{starRefusal}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* La lettera resta la lettera: `ROLE_LABELS` la porta per chi legge con
              un lettore di schermo, e qui è il plurale giusto perché il chip
              filtra un gruppo, non nomina un giocatore. Le lettere di ruolo non
              sono nel glossario — `C` e `A` stanno in tutti e due i vocabolari
              con due significati — e non sono scritte a mano: vengono da
              `CLASSIC_ROLES`. */}
          {CLASSIC_ROLES.map((role) => (
            <FilterChip
              key={role}
              active={filters.role === role}
              onToggle={() => patchFilters({ role: filters.role === role ? null : role })}
              aria-label={ROLE_LABELS[role]}
            >
              {role}
            </FilterChip>
          ))}

          <Select
            value={filters.team ?? ''}
            onChange={(v) => patchFilters({ team: v || null })}
            empty="squadra"
            options={teams.map((t) => [t, t])}
          />
          <Select
            value={filters.mantra ?? ''}
            onChange={(v) => patchFilters({ mantra: v || null })}
            empty="ruolo Mantra"
            options={MANTRA_ROLES.map((r) => [r, r])}
          />

          {/* Document 2 §4.4: a number you can type, not a switch someone else
              set. The threshold stays visible and stays editable. */}
          <label className="label flex items-center gap-1.5 text-micro text-fg-muted">
            <Abbr name="Pv" /> minime
            <input
              type="number"
              min={0}
              max={MATCHDAYS}
              className="figure-column w-14 rounded-md border border-line bg-surface-panel px-1.5 py-1 text-base"
              value={filters.minPv ?? ''}
              onChange={(e) =>
                patchFilters({ minPv: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </label>
          <FilterChip
            active={filters.minPv === PV_PRESET}
            onToggle={() =>
              patchFilters({ minPv: filters.minPv === PV_PRESET ? null : PV_PRESET })
            }
          >
            ≥ {PV_PRESET} su {MATCHDAYS}
          </FilterChip>

          <FilterChip
            active={filters.penaltyTakers}
            onToggle={() => patchFilters({ penaltyTakers: !filters.penaltyTakers })}
          >
            rigoristi
          </FilterChip>

          <div className="ml-auto flex items-center gap-3">
            {/* A menu with one entry is noise: document 2 §4.4 says so of the
                season selector, and the same holds for the statistics one. */}
            {seasons.length > 1 && (
              <Select
                value={seasonId ?? ''}
                onChange={setSeasonId}
                options={seasons.map((s) => [s.id, s.label])}
              />
            )}
            {list.statsSeasons.length > 1 && (
              <label className="label text-micro flex items-center gap-1.5 text-fg-muted">
                numeri della
                <Select
                  value={statsSeason ?? ''}
                  onChange={setStatsSeason}
                  options={[...list.statsSeasons].reverse().map((s) => [s, s])}
                />
              </label>
            )}
          </div>
        </div>

        {active.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {active.map((chip) => (
              <FilterChip
                key={chip.label}
                active
                onToggle={() => {
                  if (chip.clearQuery) setQuery('')
                  else patchFilters(chip.clear ?? {})
                }}
              >
                {chip.label}
              </FilterChip>
            ))}
            <button
              className="label text-micro text-fg-muted underline underline-offset-2 hover:text-fg"
              onClick={reset}
            >
              azzera
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
      <div ref={scroller} className="flex-1 overflow-auto">
        <DataTable>
          <DataTableHead>
            {table.getHeaderGroups().map((group) => (
              <DataTableHeadRow key={group.id}>
                {group.headers.map((header) => (
                  <DataTableHeadCell key={header.id} numeric={header.column.columnDef.meta?.numeric}>
                    <SortableHeading header={header} />
                  </DataTableHeadCell>
                ))}
              </DataTableHeadRow>
            ))}
          </DataTableHead>
          <DataTableBody>
            {/* Two spacer rows around the visible window: the scrollbar stays
                honest about six hundred rows while the DOM holds twenty. And the
                reason `DataTableRow` takes the logical index rather than striping
                with `odd:`: this row is the first child, so CSS parity counts
                from the wrong foot and the stripes would invert. */}
            <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }} />
            {virtualizer.getVirtualItems().map((item) => {
              const row = sorted[item.index]
              return (
                <DataTableRow
                  key={row.id}
                  index={item.index}
                  selected={row.original.id === selectedPlayerId}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  role="button"
                  tabIndex={0}
                  aria-current={row.original.id === selectedPlayerId}
                  onClick={() => select(row.original.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      select(row.original.id)
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <DataTableCell
                      key={cell.id}
                      numeric={cell.column.columnDef.meta?.numeric}
                      className="text-base"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </DataTableCell>
                  ))}
                </DataTableRow>
              )
            })}
            <tr
              style={{
                height:
                  virtualizer.getTotalSize() -
                  (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
              }}
            />
          </DataTableBody>
        </DataTable>

        {sorted.length === 0 && (
          <p className="px-6 py-10 text-center text-base text-fg-muted">
            Nessun giocatore con questi filtri. Togline uno per allargare la ricerca.
          </p>
        )}
      </div>

      {selected !== null && (
        <PlayerDetail
          player={selected}
          statsSeason={statsSeason}
          currentSeason={list?.seasonId ?? null}
          hasFbref={list?.hasFbref ?? false}
          onClose={() => select(null)}
          objective={
            objectives === null
              ? null
              : {
                  target: objectives.of(selected.id),
                  objectives,
                  budget: leagueQuery.data?.budget ?? null,
                  resync: starResync,
                }
          }
        />
      )}
      </div>
    </Shell>
  )
}

/**
 * `any` as the value type is TanStack's own documented shape for a column list:
 * every column reads a different type out of the row, and a single union would
 * make each accessor infer the widest one instead of its own.
 */
function buildColumns(
  hasFbref: boolean,
  objectives: Objectives | null,
  evaluation: {
    scores: Map<number, number | null>
    hasScores: boolean
    prices: Map<number, number> | null
  } | null,
  // The signature went multi-line with T12b, so the directive has to sit on the
  // line that actually holds the `any`: above the function it covered nothing,
  // and eslint reported both the `any` and the useless directive.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ColumnDef<Row, any>[] {
  const base = [
    columnHelper.accessor('name', {
      id: 'name',
      header: 'giocatore',
      // Sorted on the normalised name, the same function the search and
      // `player.name_normalized` use. Without it TanStack compares raw strings
      // with `<`, and every accented name lands after `z`: `Zè Pedro` opens the
      // descending order and closes the ascending one, seventeen names away from
      // where it belongs.
      sortingFn: (a, b) =>
        normalizeName(a.original.name).localeCompare(normalizeName(b.original.name), 'it'),
      cell: (c) => (
        <div>
          {/* Not the whole row dimmed: document 2 §4.4 reserves "riga attenuata"
              for a player someone has already bought, which arrives with T13.
              Two different states wearing one signal is worse than either. */}
          <span className={c.row.original.delisted ? 'text-fg-muted line-through' : ''}>
            {c.getValue()}
          </span>
          {/* Non più ambra: il §15 la riserva al denaro, «nemmeno una volta», e
              qui stava su una decorazione. E non più `title`, che la stessa lista
              vieta — «né per spiegare una sigla, né per nient'altro»: era anche
              l'unico modo di sapere cosa fosse il glifo, e non compariva al fuoco
              da tastiera. Il §12 vuole comunque una parola accanto al colore, e
              adesso c'è per tutti e due i lettori. */}
          {c.row.original.penaltyTaker && <Glyph mark="◉" says="rigorista" />}
          {c.row.original.delisted && (
            <Glyph mark="fuori" says={notices.DELISTED()} className="text-unavailable" />
          )}
          {c.row.original.rolesMantra.length > 0 && (
            /* 11px, come chiede il §10: «i ruoli Mantra stanno sotto il nome
               come testo a 11px in `--text-muted`, non come badge — sono fino a
               tre e riempirebbero la riga». Senza taglia esplicita rendevano a
               **16px**, perché `label` porta peso e spaziatura e non una
               misura, e nessun antenato ne dichiara una, quindi la riga cresceva
               oltre i 40 del §5. Rimisurato dopo che `DataTableRow` ha fissato
               `h-10`: la riga sta a 40,00px esatti e questa ci entra dentro. La
               stima del virtualizzatore è stata rifatta con lo stesso numero. */
            <div className="label mt-0.5 text-micro text-fg-muted">
              {c.row.original.rolesMantra.join(' · ')}
            </div>
          )}
        </div>
      ),
    }),
    columnHelper.accessor('roleClassic', {
      id: 'role',
      header: 'ruo',
      meta: { abbr: 'ruo' },
      cell: (c) => <RoleBadge role={c.getValue()} />,
    }),
    columnHelper.accessor((r) => r.teamCode ?? r.teamName, {
      id: 'team',
      header: 'squa',
      meta: { abbr: 'squa' },
    }),
    num('qt', 'qt.', (r) => r.qtClassicCurrent, 'whole'),
    num('fvm', 'FVM', (r) => r.fvmClassic, 'whole'),
    num('fm', 'FM', (r) => r.season?.fantaAvg, 'average'),
    num('mv', 'MV', (r) => r.season?.avgVote, 'average'),
    num('pv', 'Pv', (r) => r.season?.matchesRated, 'whole'),
    num('bon', 'bon', (r) => bonusIndex(r.season?.fantaAvg ?? null, r.season?.avgVote ?? null), 'signed'),
  ]

  /**
   * The score of §6, `pt.` — not `punt.`, which in an auction app reads as
   * "puntata": the word is on screen five times over, from the minimum bid to
   * the maximum, and the column beside this one is a price in credits.
   *
   * Empty for whoever has no history — 132 players out of 524 in 2026-27 — and
   * empty shows: a player with no past does not have a low score, he has none.
   * The whole column goes only when nobody has one.
   */
  if (evaluation?.hasScores) {
    base.push(num('pt', 'pt.', (r) => evaluation.scores.get(r.id) ?? null, 'average'))
  }

  /**
   * The expected price, `Pr.` in the mock of §4.4.
   *
   * Only with a league open — without budget, teams and slots there is no market
   * to normalise on — and only when somebody has a score, because the price is
   * derived from it. Both conditions are the rule of §4.4: hide what would be
   * empty instead of printing six hundred dashes. Without the second one, an
   * XLSX-only database with a league showed 524 rows of "1".
   */
  const prices = evaluation?.prices ?? null
  if (evaluation?.hasScores && prices) {
    base.push(num('pr', 'pr.', (r) => prices.get(r.id) ?? null, 'money'))
  }

  const withFbref = hasFbref
    ? [
        ...base,
        num('tit', 'tit.', (r) => startShare(r.season?.starts ?? null, r.season?.matchesPlayed ?? null), 'percent'),
        num('min', 'min', (r) => minutesPerMatch(r.season?.minutes ?? null, r.season?.matchesPlayed ?? null), 'decimal'),
        num('cs', 'CS', (r) => cleanSheetRate(r.season?.cleanSheets ?? null, r.season?.starts ?? null), 'percent'),
      ]
    : base

  if (objectives === null) return withFbref

  /**
   * The star of document 2 §4.4, last column as in its mock, and present only
   * with a league open.
   *
   * A display column and not an accessor: it is a control, and an accessor would
   * offer to sort six hundred rows by a boolean. Its clicks are stopped from
   * reaching the row — marking a player and opening his card are two intentions
   * on the same pixel, and the row already owns the second one.
   */
  return [
    ...withFbref,
    columnHelper.display({
      id: 'star',
      header: '★',
      meta: { abbr: '★' },
      cell: (c) => (
        <Star
          player={c.row.original}
          target={objectives.of(c.row.original.id)}
          objectives={objectives}
        />
      ),
    }),
  ]
}

/**
 * "La stella aggiunge agli obiettivi della lega attiva, con rating impostabile
 * al passaggio del mouse."
 *
 * So the cell has two states. At rest it is the toggle: full and amber when he is
 * an objective, hollow otherwise. Under the pointer — or the keyboard focus, for
 * whoever is not using one — the five rating stars appear beside it, and clicking
 * one of them both marks the player and rates him in a single act, which is the
 * whole point of doing it from a table of six hundred rows.
 *
 * Amber here is not decoration: a rating is not money, but the star *is* the
 * mark, and document 2 §2 reserves amber for credits. So the mark wears `target`
 * teal — the colour §2 assigns to "è nella tua lista obiettivi" — and nothing in
 * this cell is amber at all.
 */
function Star({
  player,
  target,
  objectives,
}: {
  player: Row
  target: TargetRow | null
  objectives: Objectives
}): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="flex items-center justify-end gap-0.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open &&
        Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((star) => (
          <button
            key={star}
            className={`text-base leading-none ${
              target?.rating != null && star <= target.rating
                ? 'text-targeted'
                : 'text-line hover:text-fg-muted'
            }`}
            aria-label={`${star} su ${MAX_RATING} a ${player.name}`}
            title={`${star} su ${MAX_RATING}`}
            onClick={(e) => {
              e.stopPropagation()
              objectives.patch({
                playerId: player.id,
                rating: target?.rating === star ? null : star,
              })
            }}
          >
            ★
          </button>
        ))}
      <button
        className={`ml-0.5 text-base leading-none ${target ? 'text-targeted' : 'text-fg-muted'}`}
        aria-label={target ? `togli ${player.name} dagli obiettivi` : `aggiungi ${player.name} agli obiettivi`}
        title={target ? 'togli dagli obiettivi' : 'aggiungi agli obiettivi'}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation()
          if (target) objectives.remove(player.id)
          else objectives.patch({ playerId: player.id })
        }}
      >
        {target ? '★' : '☆'}
      </button>
    </div>
  )
}

/**
 * A right-aligned numeric column whose missing values sort last in both
 * directions.
 *
 * `undefined` rather than `null`, because that is the only one TanStack's
 * `sortUndefined` recognises — with `null` the blanks would sort as if they were
 * the smallest number there is, and descending by FM would open on a screenful
 * of players who never played.
 */
function num(
  id: string,
  abbr: AbbrName,
  read: (row: Row) => number | null | undefined,
  kind: FigureKind,
) {
  return columnHelper.accessor((row) => read(row) ?? undefined, {
    id,
    // One argument, two uses: the heading TanStack needs and the glossary key the
    // `<th>` explains it with.
    header: abbr,
    sortUndefined: 'last',
    meta: { numeric: true, abbr },
    cell: (c) => (
      <Figure value={c.getValue() as number | undefined} kind={kind} animate={false} />
    ),
  })
}

/** Il chip dice la sigla e non la spiega: il §10 la spiega dove è definita —
 *  l'intestazione di colonna venti righe più su — e mai dove è usata. Passa
 *  comunque dal tipo, così è l'unica grafia in circolazione. */
const PV = 'Pv' satisfies AbbrName

type ActiveChip = { label: string; clear?: Partial<Filters>; clearQuery?: boolean }

/** Document 2 §4.4: what is on stays visible, each with an x to take it off. */
function describeFilters(filters: Filters, query: string): ActiveChip[] {
  const chips: ActiveChip[] = []
  if (query) chips.push({ label: `"${query}"`, clearQuery: true })
  if (filters.role) chips.push({ label: filters.role, clear: { role: null } })
  if (filters.team) chips.push({ label: filters.team, clear: { team: null } })
  if (filters.mantra) chips.push({ label: filters.mantra, clear: { mantra: null } })
  if (filters.minPv !== null)
    chips.push({ label: `${PV} ≥ ${filters.minPv}`, clear: { minPv: null } })
  if (filters.penaltyTakers) chips.push({ label: 'rigoristi', clear: { penaltyTakers: false } })
  return chips
}

/**
 * A column heading that sorts, and — when the heading is an abbreviation —
 * explains itself.
 *
 * The button is the trigger, not a span inside it. Two focusable things on one
 * word is two tab stops and a nesting no screen reader should be handed, and a
 * span the keyboard cannot reach would drop the focus row of §10 in the densest
 * table of the app, which is the one place where learning the abbreviations
 * matters most. `Abbr` hands the classes over for exactly this.
 */
function SortableHeading({ header }: { header: Header<Row, unknown> }): JSX.Element {
  const abbr = header.column.columnDef.meta?.abbr
  const arrow = { asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''
  const sort = header.column.getToggleSortingHandler()

  if (abbr === undefined) {
    return (
      <button className="hover:text-fg" onClick={sort}>
        {flexRender(header.column.columnDef.header, header.getContext())}
        {arrow}
      </button>
    )
  }

  return (
    <Abbr name={abbr}>
      {(label, className) => (
        <button className={cn(className, 'hover:text-fg')} onClick={sort}>
          {label}
          {arrow}
        </button>
      )}
    </Abbr>
  )
}

/**
 * `empty` is the "no choice" entry, and a select without one cannot be undone.
 *
 * The filters have it — turning a filter off is the point. The two season
 * selectors do not: there is no such thing as viewing no season, and an empty
 * entry there would blank every statistic column with no way to tell that from
 * a player who has no history.
 */
function Select({
  value,
  onChange,
  empty,
  options,
}: {
  value: string
  onChange: (value: string) => void
  empty?: string
  options: Array<[string, string]>
}): JSX.Element {
  return (
    <select
      className="label text-micro rounded-md border border-line bg-surface-panel px-2 py-1 text-fg-muted"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  )
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-screen flex-col bg-surface text-fg">{children}</div>
}
