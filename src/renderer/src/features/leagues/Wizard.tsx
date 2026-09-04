import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Figure from '@/components/Figure'
import { call, IpcError } from '@/lib/ipc'
import { useLeagueStore } from '@/stores/league'
import {
  CLASSIC_ROLES,
  coherenceWarnings,
  DEFAULT_SLOTS,
  move,
  ROLE_LABELS,
  TEAM_COLORS,
  totalSlots,
} from '@shared/domain'
import { errorMessages, warningMessage } from '@shared/errors'
import type { SlotsByRole, TeamDraft } from '@shared/types'
import TeamRows, { type TeamFields } from './TeamRows'
import { FORMAT_LABELS, MODE_LABELS } from './labels'

/**
 * The wizard of document 2 §4.3: three steps, back at any point, a final
 * summary, and the league is in `pre_auction` when it closes.
 *
 * Nothing is written until the last button. The summary is what the document
 * asks for, and a summary you can still walk away from cannot already be a row
 * in the database — so all three steps live in this component's state and leave
 * together, in the single transaction of `league.create`.
 *
 * The coherence checks of step 3 warn and never block: the "Crea lega" button
 * stays enabled with a warning under it. What does disable it is a league that
 * could not be written at all — no name, no season, fewer than two teams, a team
 * with no name. Courtesy, as always: the service refuses again, with a message.
 */

type Step = 1 | 2 | 3

const STEPS: Record<Step, string> = { 1: 'Regolamento', 2: 'Squadre', 3: 'Rosa' }

/** A draft row plus the key React needs while the rows have no id yet. */
type DraftRow = TeamDraft & { key: number }

let nextKey = 0
function blankTeam(index: number): DraftRow {
  return {
    key: nextKey++,
    name: '',
    manager: null,
    // A different tint per row, in the order of the palette: ten teams is the
    // usual size and this way nobody has to open ten pickers to tell them apart.
    color: TEAM_COLORS[index % TEAM_COLORS.length].value,
    isMine: false,
  }
}

export default function Wizard(): JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setActive = useLeagueStore((s) => s.setActiveLeague)

  const seasons = useQuery({ queryKey: ['dataset.list'], queryFn: () => call('dataset.list') })

  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [mode, setMode] = useState<'classic' | 'mantra'>('classic')
  const [auctionFormat, setAuctionFormat] = useState<'call' | 'draft'>('call')
  const [budget, setBudget] = useState(500)
  const [minBid, setMinBid] = useState(1)
  const [slots, setSlots] = useState<SlotsByRole>({ ...DEFAULT_SLOTS })
  const [teams, setTeams] = useState<DraftRow[]>([blankTeam(0), blankTeam(1)])

  // The most recent import, which is the season an auction is being prepared for
  // — the same fallback the players view uses. Chosen, never assumed: the field
  // shows it and can be changed.
  const season = seasons.data?.find((s) => s.id === seasonId) ?? seasons.data?.at(-1) ?? null

  const create = useMutation({
    mutationFn: () =>
      call('league.create', {
        name: name.trim(),
        seasonId: season?.id ?? '',
        mode,
        auctionFormat,
        budget,
        minBid,
        slots,
        // Spelled out rather than spread minus `key`: what the channel takes is
        // four fields, and a fifth added to the draft row must be answered for.
        teams: teams.map((team) => ({
          name: team.name.trim(),
          manager: team.manager,
          color: team.color,
          isMine: team.isMine,
        })),
      }),
    onSuccess: (league) => {
      void queryClient.invalidateQueries({ queryKey: ['league.list'] })
      queryClient.setQueryData(['league.get', league.id], league)
      setActive(league.id)
      navigate(`/lega/${league.id}`)
    },
  })

  const warnings = coherenceWarnings({
    teams: teams.length,
    slots,
    budget,
    minBid,
    available: season?.playersByRole ?? null,
  })

  const named = teams.every((t) => t.name.trim() !== '')
  const canCreate =
    name.trim() !== '' && season !== null && teams.length >= 2 && named && !create.isPending

  function patchTeam(index: number, patch: Partial<TeamFields>): void {
    setTeams((rows) =>
      rows.map((row, i) => {
        if (i !== index) {
          // Only one team can be yours: raising the flag here lowers it there,
          // the way the service does inside its transaction.
          return patch.isMine === true ? { ...row, isMine: false } : row
        }
        return { ...row, ...patch }
      }),
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-lg font-medium">Nuova lega</h1>

      <ol className="mt-4 flex gap-1 text-base">
        {([1, 2, 3] as Step[]).map((n) => (
          <li key={n}>
            <button
              className={`rounded-md px-2.5 py-1 ${
                n === step ? 'bg-pitch-700 text-chalk' : 'text-chalk-dim hover:text-chalk'
              }`}
              onClick={() => setStep(n)}
            >
              <Figure value={n} className="mr-1.5" />
              {STEPS[n]}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6">
        {step === 1 && (
          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="nome della lega" className="sm:col-span-2">
              <input
                className="w-full rounded-md border border-line bg-pitch-900 px-2 py-1 text-base"
                value={name}
                placeholder="Lega degli amici"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="stagione">
              <select
                className="w-full rounded-md border border-line bg-pitch-900 px-2 py-1 text-base"
                value={season?.id ?? ''}
                onChange={(e) => setSeasonId(e.target.value)}
              >
                {seasons.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="modalità">
              <Choice
                value={mode}
                options={[
                  { value: 'classic', label: MODE_LABELS.classic },
                  { value: 'mantra', label: MODE_LABELS.mantra },
                ]}
                onChange={setMode}
              />
            </Field>

            <Field label="formato dell’asta">
              <Choice
                value={auctionFormat}
                options={[
                  { value: 'call', label: FORMAT_LABELS.call },
                  { value: 'draft', label: FORMAT_LABELS.draft },
                ]}
                onChange={setAuctionFormat}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="budget">
                <NumberField value={budget} min={0} onChange={setBudget} />
              </Field>
              <Field label="puntata minima">
                <NumberField value={minBid} min={1} onChange={setMinBid} />
              </Field>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="mb-3 text-base text-chalk-dim">
              {teams.length < 2
                ? 'Aggiungi le squadre che partecipano all’asta.'
                : 'L’ordine è il turno: trascina una riga o usa le frecce.'}
            </p>

            <TeamRows
              rows={teams}
              live
              onPatch={patchTeam}
              onRemove={(i) => setTeams((rows) => rows.filter((_, index) => index !== i))}
              onMove={(from, to) => setTeams((rows) => move(rows, from, to))}
            />

            <button
              className="mt-3 rounded-md border border-line px-3 py-1.5 text-base text-chalk-dim hover:text-chalk"
              onClick={() => setTeams((rows) => [...rows, blankTeam(rows.length)])}
            >
              Aggiungi squadra
            </button>
          </section>
        )}

        {step === 3 && (
          <section>
            <div className="flex flex-wrap gap-4">
              {CLASSIC_ROLES.map((role) => (
                <Field key={role} label={ROLE_LABELS[role]}>
                  <NumberField
                    value={slots[role]}
                    min={0}
                    onChange={(n) => setSlots((s) => ({ ...s, [role]: n }))}
                  />
                </Field>
              ))}
              <Field label="totale">
                {/* The paragraph survives as the box, and it has to: `Field`
                    hands its child to a block span, so a bare `Figure` would be
                    an inline box there and its `py-1` would paint without
                    adding any height — the total would end up shorter than the
                    four inputs beside it. The numeral inside takes the column
                    role, which is the one those inputs now wear too. */}
                <p className="px-2 py-1 text-base">
                  <Figure value={totalSlots(slots)} />
                </p>
              </Field>
            </div>

            <Warnings warnings={warnings} />

            <div className="mt-8 border-t border-line pt-4">
              <h2 className="text-title font-medium">Riepilogo</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-base sm:grid-cols-[10rem_1fr]">
                <dt className="label text-micro text-chalk-dim">lega</dt>
                <dd>{name.trim() || <span className="text-chalk-dim">senza nome</span>}</dd>

                <dt className="label text-micro text-chalk-dim">stagione</dt>
                {/* The season reads `Serie A 2026/27` — `seasonLabel` in
                    `shared/listone.ts` — so it is a name, and the year inside
                    it is part of the name rather than a figure. The class goes
                    and nothing takes its place: there is no column here to line
                    up with. */}
                <dd>{season?.label ?? '—'}</dd>

                <dt className="label text-micro text-chalk-dim">regole</dt>
                <dd>
                  {MODE_LABELS[mode]}, {FORMAT_LABELS[auctionFormat]},{' '}
                  <Figure value={budget} kind="money" /> crediti, puntata minima{' '}
                  <Figure value={minBid} kind="money" />
                </dd>

                <dt className="label text-micro text-chalk-dim">rosa</dt>
                {/* No Figure here, unlike the credits above: `3/8/8/6` is a
                    single string of four numbers, and the total reads inside a
                    sentence. Both only want the tabular figures of a column. */}
                <dd className="figure-column">
                  {CLASSIC_ROLES.map((role) => slots[role]).join('/')} · {totalSlots(slots)} slot per
                  squadra
                </dd>

                <dt className="label text-micro text-chalk-dim">squadre</dt>
                <dd>
                  <ul className="space-y-0.5">
                    {teams.map((team, i) => (
                      <li key={team.key} className="flex items-center gap-2">
                        <Figure value={i + 1} className="w-4 text-right text-chalk-dim" />
                        <span
                          className="size-3 rounded-sm border border-line"
                          style={{ backgroundColor: team.color ?? 'transparent' }}
                        />
                        <span>{team.name.trim() || <em className="text-taken">senza nome</em>}</span>
                        {team.manager && <span className="text-chalk-dim">· {team.manager}</span>}
                        {team.isMine && <span className="text-chalk-dim">· la mia</span>}
                      </li>
                    ))}
                  </ul>
                </dd>
              </dl>
            </div>
          </section>
        )}
      </div>

      {create.isError && (
        <p className="mt-4 text-base text-taken">
          {create.error instanceof IpcError ? create.error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      )}

      <div className="mt-8 flex items-center gap-2 border-t border-line pt-4">
        <button
          className="rounded-md border border-line px-3 py-1.5 text-base text-chalk-dim hover:text-chalk disabled:opacity-40"
          disabled={step === 1}
          onClick={() => setStep((s) => (s - 1) as Step)}
        >
          Indietro
        </button>

        {step < 3 ? (
          <button
            className="rounded-md bg-pitch-700 px-3 py-1.5 text-base text-chalk hover:bg-line"
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            Avanti
          </button>
        ) : (
          <button
            className="rounded-md bg-pitch-700 px-3 py-1.5 text-base text-chalk hover:bg-line disabled:opacity-40"
            disabled={!canCreate}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creo…' : 'Crea lega'}
          </button>
        )}

        {step === 3 && !canCreate && !create.isPending && (
          <span className="text-base text-chalk-dim">{whatIsMissing(name, season, teams)}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Says which of the blocking conditions is not met, one at a time.
 *
 * Three of the four sentences are written here and the fourth comes from
 * `errors.ts`, and the split is the rule rather than an oversight: "servono
 * almeno due squadre" is a refusal the service can actually raise, so it is
 * quoted from the one place that words it; the other three describe a request
 * this screen will not even send, so no code exists for them and inventing one
 * would put three unreachable entries in the error map.
 */
function whatIsMissing(
  name: string,
  season: { id: string } | null,
  teams: readonly TeamDraft[],
): string {
  if (name.trim() === '') return 'Manca il nome della lega.'
  if (!season) return 'Manca la stagione: importa un listone.'
  if (teams.length < 2) return errorMessages.TOO_FEW_TEAMS()
  return 'Una squadra è senza nome.'
}

function Warnings({
  warnings,
}: {
  warnings: ReturnType<typeof coherenceWarnings>
}): JSX.Element | null {
  if (warnings.length === 0) return null

  /**
   * Chalk, non ambra.
   *
   * Il documento 2 §2 impegna l'ambra: «Se un numero è ambra è un credito.
   * Nient'altro usa quel colore, mai per decorazione.» Metà di questi avvisi
   * conta giocatori, non crediti, e una lista tutta ambra insegnerebbe a leggere
   * come denaro un numero che denaro non è. Il gesso pieno basta a farli
   * risaltare, perché tutto quello che li circonda è `chalk-dim`.
   */
  return (
    <ul className="mt-4 space-y-1">
      {warnings.map((warning) => (
        <li key={warning.code + ('role' in warning ? warning.role : '')} className="text-base text-chalk">
          {warningMessage(warning)}
        </li>
      ))}
    </ul>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="label block text-micro text-chalk-dim">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function NumberField({
  value,
  min,
  onChange,
}: {
  value: number
  min: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    // An input cannot host a `Figure`, so it wears the column role itself —
    // Plex 500 with tabular figures, the same shape the number will keep once
    // it is read back in the summary.
    <input
      type="number"
      className="figure-column w-24 rounded-md border border-line bg-pitch-900 px-2 py-1 text-base"
      value={value}
      min={min}
      onChange={(e) => {
        const parsed = Number(e.target.value)
        // An empty field parses as 0 and a cleared box should not silently mean
        // zero credits, so anything unreadable leaves the value where it was.
        //
        // Truncated, like the twin in LeagueView: `type="number"` accepts `500.5`
        // and every one of these fields feeds a `z.number().int()`. Without this
        // the wizard sends a budget with a decimal in it and the answer is
        // "Richiesta non valida", which does not say which of six fields it means.
        if (Number.isFinite(parsed) && e.target.value !== '') {
          onChange(Math.max(min, Math.trunc(parsed)))
        }
      }}
    />
  )
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          className={`rounded-md border px-2.5 py-1 text-base ${
            option.value === value
              ? 'border-line bg-pitch-700 text-chalk'
              : 'border-line text-chalk-dim hover:text-chalk'
          }`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
