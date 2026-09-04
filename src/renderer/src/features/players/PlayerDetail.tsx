import { useEffect, useMemo, useRef, useState } from 'react'
import {
  bonusIndex,
  chartBounds,
  cleanSheetRate,
  concededPerMatch,
  hasHistory,
  malusRate,
  MATCHDAYS,
  MAX_RATING,
  minutesPerMatch,
  reliability,
  seasonWindow,
  spelledOut,
  startShare,
  TIERS,
} from '@shared/domain'
import type { PlayerRow, SeasonStats, TargetRow } from '@shared/types'
import PriceField from '@/components/PriceField'
import Abbr from '@/components/Abbr'
import Figure from '@/components/Figure'
import { show } from '@/lib/format'
import { glossary, type Abbr as AbbrName } from '@shared/glossary'
import type { Objectives } from '@/features/targets/objectives'

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
 * The objective block §4.5 ends with is at the bottom, and only when a league is
 * open: T12 brought it, and the rule the view rests on decides the other case —
 * §4.4 hides what can only be empty rather than "mostrare quindici trattini".
 */
export default function PlayerDetail({
  player,
  statsSeason,
  currentSeason,
  hasFbref,
  onClose,
  objective,
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
  /**
   * The objective block of §4.5, or null when no league is open.
   *
   * Null and not an empty block: §4.4's rule for a column that can only be empty
   * — "le nasconde invece di mostrare quindici trattini" — applies to a whole
   * section with more force. Whose objectives would it be?
   */
  objective: {
    target: TargetRow | null
    objectives: Objectives
    /** For the share the maximum price is of it. Null if the query is still out. */
    budget: number | null
    /** Bumped on every refusal: it is the key that remounts the block. */
    resync: number
  } | null
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
            {/*
              Under the heading and not inside it: the heading is what the
              listone calls him, and it is what every other pane of the app —
              roster, report, snapshot — will keep calling him.
            */}
            {spelledOut(player.name, player.fullName) !== null && (
              <p className="text-sm text-chalk-dim">{spelledOut(player.name, player.fullName)}</p>
            )}
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

      {objective && (
        <Objective
          /**
           * Rimontato a ogni rifiuto, come le righe squadra di T11 e le tessere
           * della board: dopo un rifiuto il valore che arriva dall'alto e' quello
           * di prima, quindi un campo che si risincronizza solo quando quel
           * valore cambia resta a mostrare cio' che l'errore ha appena respinto.
           */
          key={`${player.id}-${objective.resync}`}
          player={player}
          target={objective.target}
          objectives={objective.objectives}
          budget={objective.budget}
        />
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

/**
 * A `<dt>` that is an abbreviation and a `<dd>` that is its number.
 *
 * There used to be a `qualifier` prop here, so that "qt. iniziale" could be
 * drawn as `qt.` plus an ordinary word beside it rather than becoming a key of
 * its own. It did not work, and it failed in the way §10 exists to prevent:
 * the word sat *outside* `Abbr`, so the popover over "qt. iniziale" opened on
 * "Quotazione attuale" — over the one number on the panel that is not the
 * current one — and a screen reader heard "qt. — Quotazione attuale iniziale".
 * Worse, the row is drawn *only* when initial and current differ, so the lie
 * appeared exactly when it mattered, two elements from the `qt.` it belonged
 * to. It is a glossary key now, which is also what the decision the key is the
 * string on screen already said it should be.
 *
 * `animate={false}` for the same reason `AssignPanel` gives: a Fact's number
 * changes when the *player* changes, never on its own. The panel is mounted
 * without a `key` (`PlayersView`), so walking from one player to the next
 * reuses these instances, and a count-up would travel from the previous
 * player's quotazione to this one's — a movement document 2 §2 does not list,
 * and a number that is briefly neither player's.
 */
function Fact({
  term,
  value,
  money = false,
}: {
  term: AbbrName
  value: number | null
  money?: boolean
}): JSX.Element {
  return (
    <div>
      <dt className="label text-sm text-chalk-dim">
        <Abbr name={term} />
      </dt>
      <dd>
        <Figure value={value} kind={money ? 'money' : 'whole'} size="md" animate={false} />
      </dd>
    </div>
  )
}

/*
 * I cinque formattatori e `show()` stavano qui, copia identica di quelli in
 * fondo a `PlayersView.tsx` — 667 byte per parte, con i commenti da una parte
 * sola. Ora stanno in `lib/format.ts`, che è anche dove `Figure` li legge.
 */

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
          <th className="border-b border-line py-1 text-right">
            <Abbr name="Pv" />
          </th>
          <th className="border-b border-line py-1 text-right">
            <Abbr name="MV" />
          </th>
          <th className="border-b border-line py-1 text-right">
            <Abbr name="FM" />
          </th>
          {showMinutes && (
            <th className="border-b border-line py-1 text-right">
              <Abbr name="min" />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {seasons.map((season) => {
          const row = stats[season]
          return (
            <tr key={season} className="border-b border-line/50">
              <td className="py-1">{season}</td>
              <td className="py-1 text-right">
                <Figure value={row.matchesRated} />
              </td>
              <td className="py-1 text-right">
                <Figure value={row.avgVote} kind="average" />
              </td>
              <td className="py-1 text-right">
                <Figure value={row.fantaAvg} kind="average" />
              </td>
              {showMinutes && (
                <td className="py-1 text-right">
                  <Figure value={minutesPerMatch(row.minutes, row.matchesPlayed)} kind="decimal" />
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
        /* Per esteso e non le sigle: un'etichetta per lettori di schermo è una
           frase, e il §10 vuole l'espansione dove c'è spazio per scriverla. */
        aria-label={`Andamento di ${glossary.FM.full.toLowerCase()} e ${glossary.MV.full.toLowerCase()} dal ${seasons[0]} al ${seasons[seasons.length - 1]}`}
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
          <span className="text-chalk">
            <Abbr name="FM" /> piena
          </span>
          , <Abbr name="MV" /> tratteggiata
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
  const rows: IndicatorRow[] = [
    { abbr: 'bon', value: show(bonusIndex(stats.fantaAvg, stats.avgVote), 'signed') },
    {
      word: 'affidabilità',
      value: show(reliability(pv), 'percent'),
      note: `In quante delle ${MATCHDAYS} giornate ha preso un voto. Chi è arrivato a gennaio scende, anche se ha giocato sempre.`,
    },
    {
      word: 'malus',
      value: show(malusRate(stats.yellowCards, stats.redCards, stats.ownGoals, pv), 'average'),
      note: 'Cartellini e autogol per partita a voto. Il rosso pesa il doppio del giallo.',
    },
  ]

  if (role === 'P') {
    rows.push({
      word: 'gol subiti',
      value: show(concededPerMatch(stats.goalsConceded, pv), 'average'),
      note: 'Reti incassate per partita a voto. Conta col modificatore di difesa.',
    })
  }

  if (hasFbref) {
    rows.push(
      { abbr: 'tit.', value: show(startShare(stats.starts, stats.matchesPlayed), 'percent') },
      { abbr: 'min', value: show(minutesPerMatch(stats.minutes, stats.matchesPlayed), 'decimal') },
    )
    if (role === 'P') {
      rows.push({ abbr: 'CS', value: show(cleanSheetRate(stats.cleanSheets, stats.starts), 'percent') })
    }
  }

  return (
    <dl className="space-y-3">
      {rows.map((row) => {
        const key = 'abbr' in row ? row.abbr : row.word
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="label text-sm">
                {'abbr' in row ? <Abbr name={row.abbr} /> : row.word}
              </dt>
              <dd className="figure-column">{row.value}</dd>
            </div>
            <p className="mt-0.5 text-sm text-chalk-dim">
              {'abbr' in row ? glossary[row.abbr].explains : row.note}
            </p>
          </div>
        )
      })}
      {pv !== null && pv > 0 && pv < 10 && (
        /* Document 2 §9: what is thin shows what it has, with Pv beside it to
           qualify it. Not a threshold that hides — that is the hidden threshold
           the titolari filter already refused. */
        <p className="pt-1 text-sm text-chalk-dim">
          {pv === 1
            ? 'Tutto qui sopra riposa su una partita a voto.'
            : `Tutto qui sopra riposa su ${show(pv)} partite a voto.`}
        </p>
      )}
    </dl>
  )
}

/**
 * Una riga di indicatore: o una sigla, e allora la spiegazione è quella del
 * glossario, o una parola intera, e allora se la porta.
 *
 * È il punto dove due specifiche si toccavano e nessuna delle due si diceva
 * superata. Il documento 2 §4.5 vuole che ogni indicatore derivato abbia «una
 * riga di spiegazione in linguaggio piano» **in loco**; il documento 7 §10 vuole
 * che «una sigla si spiega dove è definita, mai dove è usata». Qui vincono
 * entrambe: la riga resta — è l'unico posto dell'app con lo spazio per scriverla,
 * e la regola del §10 punta alle tabelle da seicento celle, che nomina per
 * esteso — ma il testo non è più una seconda copia. Era: `bon` aveva «quanto la
 * fantamedia supera la media voto» nel pannello di riferimento e «quanto aggiunge
 * al voto in gol e assist» qui, e nessuna delle due sapeva dell'altra.
 *
 * Un'unione discriminata e non un campo facoltativo, per la stessa ragione per
 * cui `Violation` in `domain.ts` lo è: con `note?: string` una riga con una sigla
 * potrebbe portarsi comunque un testo proprio, e la divergenza tornerebbe da
 * dove è appena stata tolta.
 */
type IndicatorRow =
  | { abbr: AbbrName; value: string }
  | { word: string; value: string; note: string }

/**
 * Il blocco obiettivo del §4.5: «fascia, prezzo massimo, rating, note. Si compila
 * da qui senza aprire altro.»
 *
 * Sta in fondo al pannello perché è l'unica parte che scrive: sopra si legge chi
 * è il giocatore, qui si decide cosa farne. Un giocatore che non è ancora un
 * obiettivo mostra lo stesso i campi — compilarne uno lo aggiunge — perché la
 * strada opposta, un bottone «aggiungi» seguito da quattro campi che compaiono,
 * è un gesto in più per fare la stessa cosa.
 */
function Objective({
  player,
  target,
  objectives,
  budget,
}: {
  player: PlayerRow
  target: TargetRow | null
  objectives: Objectives
  budget: number | null
}): JSX.Element {
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="label text-sm">obiettivo</h3>
        {target && (
          <button
            className="text-sm text-chalk-dim hover:text-taken"
            onClick={() => objectives.remove(player.id)}
          >
            togli
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-[6rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
        <dt className="label text-chalk-dim">fascia</dt>
        <dd>
          <select
            className="rounded-md border border-line bg-pitch-900 px-2 py-1 text-sm"
            value={target?.tier ?? ''}
            onChange={(e) =>
              objectives.patch({
                playerId: player.id,
                tier: e.target.value === '' ? null : window.Number(e.target.value),
              })
            }
          >
            <option value="">senza fascia</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                fascia {tier}
              </option>
            ))}
          </select>
        </dd>

        <dt className="label text-chalk-dim">prezzo massimo</dt>
        <dd className="flex items-baseline gap-2">
          <PriceField
            value={target?.maxPrice ?? null}
            label={`prezzo massimo di ${player.name}`}
            onCommit={(maxPrice) => objectives.patch({ playerId: player.id, maxPrice })}
          />
          {/* Quanto pesa sul budget: è il numero che la board somma per fascia,
              e vederlo qui evita di scoprire solo là che le prime scelte non
              stanno insieme. */}
          {budget !== null && budget > 0 && target?.maxPrice != null && (
            <span className="text-sm text-chalk-dim">
              {Math.round((target.maxPrice / budget) * 100)}% del budget
            </span>
          )}
        </dd>

        <dt className="label text-chalk-dim">rating</dt>
        <dd className="flex">
          {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((star) => (
            <button
              key={star}
              className={`px-0.5 leading-none ${
                target?.rating != null && star <= target.rating
                  ? 'text-target'
                  : 'text-line hover:text-chalk-dim'
              }`}
              aria-label={`${star} su ${MAX_RATING} a ${player.name}`}
              onClick={() =>
                objectives.patch({
                  playerId: player.id,
                  rating: target?.rating === star ? null : star,
                })
              }
            >
              ★
            </button>
          ))}
        </dd>

        <dt className="label self-start pt-1 text-chalk-dim">note</dt>
        <dd>
          <Note
            key={`${player.id}-${target?.note ?? ''}`}
            value={target?.note ?? ''}
            onCommit={(note) => objectives.patch({ playerId: player.id, note: note || null })}
          />
        </dd>
      </dl>
    </section>
  )
}

/**
 * Le note si consegnano al blur, e qui va bene: non c'è nessun bottone che
 * dipenda dal loro valore, che è la metà della trappola del CLAUDE.md che morde.
 * L'altra metà — il campo che resta a mostrare un valore respinto — la copre la
 * `key` che il chiamante costruisce sul valore vero.
 */
function Note({
  value,
  onCommit,
}: {
  value: string
  onCommit: (next: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      rows={2}
      maxLength={500}
      className="w-full rounded-md border border-line bg-pitch-900 px-2 py-1 text-sm"
      placeholder="Solo se scende sotto 40"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft.trim())}
    />
  )
}
