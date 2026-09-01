import { useEffect, useMemo, useRef } from 'react'
import {
  bonusIndex,
  chartBounds,
  cleanSheetRate,
  concededPerMatch,
  hasHistory,
  malusRate,
  MATCHDAYS,
  minutesPerMatch,
  reliability,
  seasonWindow,
  startShare,
} from '@shared/domain'
import type { PlayerRow, SeasonStats } from '@shared/types'

/**
 * Dettaglio giocatore, document 2 §4.5: the panel the Giocatori view opens on a
 * click.
 *
 * It costs no round trip. `playerRow.stats` already carries the whole history
 * of every player — the contract says so and says why — so the panel is built
 * from data the renderer is already holding, and opening it cannot fail or
 * spin. That is also why there is no `player.get` channel: adding one would
 * fetch a second copy of what arrived with the listone.
 *
 * The objective block §4.5 ends with is not here. It needs a league (T11) and
 * the objectives themselves (T12), and the rule the whole Giocatori view rests
 * on says what to do meanwhile: §4.4 hides what can only be empty rather than
 * "mostrare quindici trattini".
 */
export default function PlayerDetail({
  player,
  statsSeason,
  currentSeason,
  hasFbref,
  onClose,
}: {
  player: PlayerRow
  /** The season the table is showing: the indicators speak about that one. */
  statsSeason: string | null
  /**
   * The season the listone belongs to. Not history — every player has a row for
   * it — and the one the empty state of §8 leaves out of its window.
   */
  currentSeason: string | null
  hasFbref: boolean
  onClose: () => void
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  /**
   * Esc closes, as §4.5 asks. On `document` rather than the panel, because the
   * reader who just clicked a row still has the focus on that row: a handler
   * bound to the panel would only fire once something inside it was focused,
   * and the key would look broken exactly on the first press.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Opening a different player rewinds the panel: T10 keeps one panel mounted
  // and swaps its contents, so without this the second player opens scrolled to
  // wherever the first one was left.
  useEffect(() => {
    panel.current?.scrollTo(0, 0)
  }, [player.id])

  const seasons = useMemo(() => Object.keys(player.stats).sort(), [player.stats])
  /** Past seasons: what "storico" means, and the window §8 names. */
  const past = useMemo(() => seasons.filter((s) => s !== currentSeason), [seasons, currentSeason])
  const history = hasHistory(player.stats, currentSeason)
  const current = statsSeason ? player.stats[statsSeason] : undefined

  /**
   * The FBref column of a table that spans every season cannot be decided by the
   * flag of the one season the view happens to show: the CSVs are downloaded a
   * season at a time, so a dataset can carry minutes for 2025-26 and none for
   * 2023-24. Ask the rows on screen instead.
   */
  const showMinutes =
    hasFbref && seasons.some((s) => player.stats[s].matchesPlayed !== null)

  return (
    <aside
      ref={panel}
      aria-label={`Dettaglio di ${player.name}`}
      className="flex w-[420px] shrink-0 flex-col overflow-auto border-l border-line bg-pitch-800"
    >
      <header className="sticky top-0 border-b border-line bg-pitch-800 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">{player.name}</h2>
            <p className="mt-1 text-sm text-chalk-dim">
              {player.roleClassic} · {player.teamName}
              {player.rolesMantra.length > 0 && ` · ${player.rolesMantra.join(' ')}`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="label rounded-md border border-line px-2 py-1 text-sm text-chalk-dim hover:text-chalk"
          >
            Esc
          </button>
        </div>

        <dl className="mt-4 flex gap-6">
          <Fact term="qt." value={player.qtClassicCurrent} money />
          <Fact term="FVM" value={player.fvmClassic} money />
          {player.qtClassicInitial !== null &&
            player.qtClassicInitial !== player.qtClassicCurrent && (
              <Fact term="qt. iniziale" value={player.qtClassicInitial} />
            )}
        </dl>

        {(player.penaltyTaker || player.delisted) && (
          <p className="mt-3 text-sm text-chalk-dim">
            {player.penaltyTaker && 'Tira i rigori.'}
            {player.penaltyTaker && player.delisted && ' '}
            {/* Invariant 10: he left the listone, his purchases did not. */}
            {player.delisted && 'Non è più nel listone importato.'}
          </p>
        )}
      </header>

      {history ? (
        <>
          <Section title="Storico">
            <HistoryTable seasons={seasons} stats={player.stats} showMinutes={showMinutes} />
            <Chart seasons={seasons} stats={player.stats} />
          </Section>

          <Section title={statsSeason ? `Indicatori ${statsSeason}` : 'Indicatori'}>
            <Indicators
              stats={current}
              role={player.roleClassic}
              hasFbref={showMinutes}
              seasons={seasons}
              season={statsSeason}
            />
          </Section>
        </>
      ) : (
        /**
         * Document 2 §8, the one deliberate exception to "uno stato vuoto è un
         * invito ad agire": there is no action to propose, because he did not
         * play, and an invented invitation would be worse than the silence. It
         * does not say "esordiente" — most of these arrived from abroad or from
         * Serie B — and it names the window it looked in, read from the seasons
         * present rather than written by hand.
         */
        <>
          <p className="px-5 py-8 text-sm text-chalk-dim">
            {seasonWindow(past)
              ? `Nessuna presenza nelle stagioni disponibili (${seasonWindow(past)}).`
              : 'Nessuna presenza nelle stagioni disponibili.'}
          </p>
          {/* Document 4 §4: "a un'asta di inizio settembre la forma attuale pesa
              quanto lo storico". Having no past is not a reason to hide the two
              matchdays he does have — §9 forbids hiding what exists. */}
          {currentSeason !== null &&
            player.stats[currentSeason] !== undefined &&
            (player.stats[currentSeason].matchesRated ?? 0) > 0 && (
              <Section title={`Stagione in corso ${currentSeason}`}>
                <HistoryTable
                  seasons={[currentSeason]}
                  stats={player.stats}
                  showMinutes={showMinutes}
                />
              </Section>
            )}
        </>
      )}
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="border-b border-line px-5 py-4">
      <h3 className="label mb-3 text-sm text-chalk-dim">{title}</h3>
      {children}
    </section>
  )
}

function Fact({
  term,
  value,
  money = false,
}: {
  term: string
  value: number | null
  money?: boolean
}): JSX.Element {
  return (
    <div>
      <dt className="label text-sm text-chalk-dim">{term}</dt>
      <dd className={`figures text-lg ${money ? 'text-credit' : ''}`}>
        {value === null ? '—' : whole.format(value)}
      </dd>
    </div>
  )
}

const whole = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const dec1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dec2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = new Intl.NumberFormat('it-IT', {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const pct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 0 })

function show(value: number | null | undefined, format: Intl.NumberFormat): string {
  return value === null || value === undefined ? '—' : format.format(value)
}

/**
 * Season by season, oldest first, so the eye reads the career left to right the
 * same way the chart under it does.
 *
 * `Pv` sits next to the averages rather than at the end, because document 2 §9
 * makes it the qualifier that keeps a thin history honest: "`6,80 su 4 Pv`
 * nessuno lo confonde con `6,80 su 34 Pv`". Hiding the row would have been the
 * hidden threshold that same paragraph refuses.
 */
function HistoryTable({
  seasons,
  stats,
  showMinutes,
}: {
  seasons: readonly string[]
  stats: Record<string, SeasonStats>
  showMinutes: boolean
}): JSX.Element {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="label text-chalk-dim">
          <th className="border-b border-line py-1 text-left">stagione</th>
          <th className="border-b border-line py-1 text-right">Pv</th>
          <th className="border-b border-line py-1 text-right">MV</th>
          <th className="border-b border-line py-1 text-right">FM</th>
          {showMinutes && <th className="border-b border-line py-1 text-right">min</th>}
        </tr>
      </thead>
      <tbody>
        {seasons.map((season) => {
          const row = stats[season]
          return (
            <tr key={season} className="border-b border-line/50">
              <td className="py-1">{season}</td>
              <td className="figures py-1 text-right">{show(row.matchesRated, whole)}</td>
              <td className="figures py-1 text-right">{show(row.avgVote, dec2)}</td>
              <td className="figures py-1 text-right">{show(row.fantaAvg, dec2)}</td>
              {showMinutes && (
                <td className="figures py-1 text-right">
                  {show(minutesPerMatch(row.minutes, row.matchesPlayed), dec1)}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const CHART_W = 372
const CHART_H = 96
const CHART_PAD = 4

/**
 * FM and MV over the available seasons, document 2 §4.5, and §9 keeps it in v1.
 *
 * Drawn by hand rather than with a chart library: two series over at most four
 * points do not justify a dependency, and the SVG reads the palette straight
 * from the tokens, which is what makes the restyling of phase 8 a change of
 * `currentColor` instead of a fight with someone else's theme.
 *
 * Gaps are gaps: a season with no FM breaks the line instead of dropping it to
 * zero, because a false zero says "he was terrible" where the data says
 * "nothing was recorded".
 */
function Chart({
  seasons,
  stats,
}: {
  seasons: readonly string[]
  stats: Record<string, SeasonStats>
}): JSX.Element | null {
  const fm = seasons.map((s) => stats[s].fantaAvg)
  const mv = seasons.map((s) => stats[s].avgVote)
  const bounds = chartBounds([fm, mv])
  if (bounds === null) return null

  // Inset by the dot radius: at x = 0 and x = CHART_W the SVG root clips the
  // first and last dot of every series in half.
  const x = (i: number): number =>
    seasons.length === 1
      ? CHART_W / 2
      : CHART_PAD + (i / (seasons.length - 1)) * (CHART_W - 2 * CHART_PAD)
  const y = (v: number): number =>
    CHART_H - ((v - bounds.min) / (bounds.max - bounds.min)) * CHART_H

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        role="img"
        aria-label={`Andamento di FM e MV dal ${seasons[0]} al ${seasons[seasons.length - 1]}`}
      >
        <Line values={mv} x={x} y={y} className="text-chalk-dim" dashed />
        <Line values={fm} x={x} y={y} className="text-chalk" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-sm text-chalk-dim">
        {/* Document 2 §2: "L'ambra è riservata al denaro… Nient'altro usa quel
            colore." FM is an average, not a credit, so the two series separate
            by weight and dash instead — and the legend says which is which
            rather than relying on the colour alone. */}
        <span>
          <span className="text-chalk">FM piena</span>, MV tratteggiata
        </span>
        <span>
          {seasons[0]}
          {seasons.length > 1 && ` → ${seasons[seasons.length - 1]}`}
        </span>
      </figcaption>
    </figure>
  )
}

/**
 * One series. Consecutive runs of real values become their own polyline, so a
 * hole in the middle leaves a hole on screen; an isolated value still gets a
 * dot, which a polyline of one point would not draw.
 */
function Line({
  values,
  x,
  y,
  className,
  dashed = false,
}: {
  values: readonly (number | null)[]
  x: (i: number) => number
  y: (v: number) => number
  className: string
  dashed?: boolean
}): JSX.Element {
  const runs: { i: number; v: number }[][] = []
  let run: { i: number; v: number }[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 0) runs.push(run)
      run = []
    } else run.push({ i, v })
  })
  if (run.length > 0) runs.push(run)

  return (
    <g className={className}>
      {runs.map((points, k) =>
        points.length === 1 ? (
          <circle key={k} cx={x(points[0].i)} cy={y(points[0].v)} r="3" fill="currentColor" />
        ) : (
          <polyline
            key={k}
            points={points.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={dashed ? '4 3' : undefined}
          />
        ),
      )}
      {runs.flat().map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="2.5" fill="currentColor" />
      ))}
    </g>
  )
}

/**
 * The derived indicators of document 1 §6, each with the line of plain language
 * §4.5 asks for, "perché «bonus index +2,7» non dice niente da solo".
 *
 * Three of them exist only if the FBref stage ran, and §6 says the interface
 * hides them rather than showing empty columns. Two more are goalkeepers' own —
 * conceding and clean sheets say nothing about a winger — so they follow the
 * role instead of appearing everywhere at nought.
 */
function Indicators({
  stats,
  role,
  hasFbref,
  seasons,
  season,
}: {
  stats: SeasonStats | undefined
  role: string
  hasFbref: boolean
  seasons: readonly string[]
  season: string | null
}): JSX.Element {
  if (stats === undefined || season === null || !seasons.includes(season)) {
    return (
      <p className="text-sm text-chalk-dim">
        Nessun dato per questa stagione. Cambia stagione per vedere gli indicatori.
      </p>
    )
  }

  const pv = stats.matchesRated
  const rows: { term: string; value: string; note: string }[] = [
    {
      term: 'bon',
      value: show(bonusIndex(stats.fantaAvg, stats.avgVote), signed),
      note: 'Quanto aggiunge al voto in gol e assist. Sotto zero i malus pesano più dei bonus.',
    },
    {
      term: 'affidabilità',
      value: show(reliability(pv), pct),
      note: `In quante delle ${MATCHDAYS} giornate ha preso un voto. Chi è arrivato a gennaio scende, anche se ha giocato sempre.`,
    },
    {
      term: 'malus',
      value: show(
        malusRate(stats.yellowCards, stats.redCards, stats.ownGoals, pv),
        dec2,
      ),
      note: 'Cartellini e autogol per partita a voto. Il rosso pesa il doppio del giallo.',
    },
  ]

  if (role === 'P') {
    rows.push({
      term: 'gol subiti',
      value: show(concededPerMatch(stats.goalsConceded, pv), dec2),
      note: 'Reti incassate per partita a voto. Conta col modificatore di difesa.',
    })
  }

  if (hasFbref) {
    rows.push(
      {
        term: 'tit.',
        value: show(startShare(stats.starts, stats.matchesPlayed), pct),
        note: 'Quante delle sue presenze sono da titolare. Il resto sono ingressi dalla panchina.',
      },
      {
        term: 'min',
        value: show(minutesPerMatch(stats.minutes, stats.matchesPlayed), dec1),
        note: 'Minuti medi quando scende in campo.',
      },
    )
    if (role === 'P') {
      rows.push({
        term: 'CS',
        value: show(cleanSheetRate(stats.cleanSheets, stats.starts), pct),
        note: 'Porte inviolate sulle partite iniziate da titolare.',
      })
    }
  }

  return (
    <dl className="space-y-3">
      {rows.map((row) => (
        <div key={row.term}>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label text-sm">{row.term}</dt>
            <dd className="figures">{row.value}</dd>
          </div>
          <p className="mt-0.5 text-sm text-chalk-dim">{row.note}</p>
        </div>
      ))}
      {pv !== null && pv > 0 && pv < 10 && (
        /* Document 2 §9: what is thin shows what it has, with Pv beside it to
           qualify it. Not a threshold that hides — that is the hidden threshold
           the titolari filter already refused. */
        <p className="pt-1 text-sm text-chalk-dim">
          {pv === 1
            ? 'Tutto qui sopra riposa su una partita a voto.'
            : `Tutto qui sopra riposa su ${whole.format(pv)} partite a voto.`}
        </p>
      )}
    </dl>
  )
}
