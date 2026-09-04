import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { call, IpcError } from '@/lib/ipc'
import { useLeagueStore } from '@/stores/league'
import {
  CLASSIC_ROLES,
  coherenceWarnings,
  frozen,
  move,
  ROLE_LABELS,
  rulesEditable,
  TEAM_COLORS,
  teamListEditable,
  totalSlots,
} from '@shared/domain'
import { errorMessages, notices, warningMessage } from '@shared/errors'
import type { Input } from '@shared/contracts'
import type { LeagueDetail } from '@shared/types'
import TeamRows, { type TeamFields } from './TeamRows'
import { FORMAT_LABELS, INSTANCE_ROLE_LABELS, MODE_LABELS, STATUS_LABELS } from './labels'

/**
 * The league: its teams, in the order that is the turn, and the rules that are
 * still open. The section document 2 §3 calls "Squadre (partecipanti, ordine,
 * colori)", with the rules under it because invariant 16 leaves them editable
 * until the auction starts and §3 gives them no room of their own.
 *
 * What the interface refuses, it refuses the way document 1 §5 wants: the service
 * decides, this only greys out and says why. Everything on this page goes through
 * `rulesEditable`, `teamListEditable` and `frozen` — the same three functions the
 * main process calls — so the two can disagree about the state of a league but
 * never about what that state allows.
 */

export default function LeagueView(): JSX.Element {
  const params = useParams()
  const id = window.Number(params.id)
  const setActive = useLeagueStore((s) => s.setActiveLeague)

  const league = useQuery({
    queryKey: ['league.get', id],
    queryFn: () => call('league.get', { id }),
    enabled: Number.isInteger(id),
  })

  // The sidebar and the players view follow the league that is open, per
  // document 2 §9. The route is what says so; this only carries it.
  useEffect(() => {
    if (Number.isInteger(id)) setActive(id)
  }, [id, setActive])

  if (league.isPending) return <Frame>{null}</Frame>

  if (league.isError) {
    return (
      <Frame>
        <p className="text-base text-blocking">
          {league.error instanceof IpcError ? league.error.message : errorMessages.IPC_UNAVAILABLE()}
        </p>
      </Frame>
    )
  }

  if (league.data === null) {
    return (
      <Frame>
        <p className="text-base text-fg-muted">{errorMessages.LEAGUE_MISSING()}</p>
      </Frame>
    )
  }

  return <Loaded league={league.data} />
}

function Loaded({ league }: { league: LeagueDetail }): JSX.Element {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setActive = useLeagueStore((s) => s.setActiveLeague)
  const seasons = useQuery({ queryKey: ['dataset.list'], queryFn: () => call('dataset.list') })

  /**
   * Every mutation of T11 answers with the whole league, so the cache is written
   * rather than invalidated: no second round trip, and the rows never blink back
   * to their old order between the answer and the refetch. The home is a
   * different shape and does get invalidated.
   */
  function absorb(next: LeagueDetail): void {
    queryClient.setQueryData(['league.get', league.id], next)
    void queryClient.invalidateQueries({ queryKey: ['league.list'] })
  }

  const [refusal, setRefusal] = useState<string | null>(null)

  /**
   * Bumped on every refusal, and used as the key of the rows.
   *
   * A refused rename leaves the database exactly as it was, which means the
   * value handed back to the row is the value it already had — so a field that
   * only resyncs when its prop *changes* would go on showing the name that was
   * just rejected, with the refusal printed above it. Remounting the list throws
   * away every half-typed draft and puts the league back on screen.
   */
  const [resync, setResync] = useState(0)

  function guard<T>(run: (input: T) => Promise<LeagueDetail>) {
    return async (input: T): Promise<void> => {
      setRefusal(null)
      try {
        absorb(await run(input))
      } catch (e) {
        setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE())
        setResync((n) => n + 1)
      }
    }
  }

  const patchTeam = guard((input: Input<'team.update'>) => call('team.update', input))
  const addTeam = guard((input: Input<'team.create'>) => call('team.create', input))
  const removeTeam = guard((input: Input<'team.delete'>) => call('team.delete', input))
  const reorder = guard((input: Input<'team.reorder'>) => call('team.reorder', input))
  const patchLeague = guard((input: Input<'league.update'>) => call('league.update', input))

  const remove = useMutation({
    mutationFn: () => call('league.delete', { id: league.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['league.list'] })
      queryClient.removeQueries({ queryKey: ['league.get', league.id] })
      setActive(null)
      navigate('/')
    },
    onError: (e) =>
      setRefusal(e instanceof IpcError ? e.message : errorMessages.IPC_UNAVAILABLE()),
  })

  const season = seasons.data?.find((s) => s.id === league.seasonId) ?? null
  const warnings = coherenceWarnings({
    teams: league.teamCount,
    slots: league.slots,
    budget: league.budget,
    minBid: league.minBid,
    available: season?.playersByRole ?? null,
  })

  const listLocked = !teamListEditable(league.status)
  const readOnly = frozen(league.status)
  const rulesOpen = rulesEditable(league.status)

  return (
    <Frame>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-heading font-medium">{league.name}</h1>
        {/* Not a figure: "2026-27" is the name of a season, not a quantity, and
            this header wraps rather than aligning, so there is no column for
            tabular digits to hold. Document 7 §4 gives the numeric roles to
            numbers, and a label that happens to contain digits is not one. */}
        <span className="text-base text-fg-muted">{league.seasonLabel}</span>
        <span className="text-base text-fg-muted">
          {MODE_LABELS[league.mode]} · {FORMAT_LABELS[league.auctionFormat]}
        </span>
        <span className="ml-auto text-base text-fg-muted">{STATUS_LABELS[league.status]}</span>
      </header>

      {refusal && <p className="mt-4 text-base text-blocking">{refusal}</p>}

      <section className="mt-8">
        <h2 className="text-title font-medium">Squadre</h2>

        {league.teams.length === 0 ? (
          // Document 2 §8, parola per parola.
          <p className="mt-2 text-base text-fg-muted">
            Aggiungi le squadre che partecipano all’asta.
          </p>
        ) : (
          <div className="mt-3">
            {/* La frase che il Wizard scrive gia' sopra la stessa lista. Qui non
                c'era, e l'unico posto che diceva cosa cambia trascinando era un
                attributo `title` sulla maniglia — che il §15 vieta e che T25 ha
                tolto. Il `cursor-grab` invita a trascinare; non dice a cosa
                serve. */}
            <p className="mb-3 text-base text-fg-muted">
              L’ordine è il turno: trascina una riga o usa le frecce.
            </p>
            <TeamRows
              key={resync}
              rows={league.teams.map((team) => ({ ...team, key: team.id }))}
              locked={listLocked}
              frozen={readOnly}
              onPatch={(index, patch) =>
                void patchTeam({ id: league.teams[index].id, ...toPatch(patch) })
              }
              onRemove={(index) => void removeTeam({ id: league.teams[index].id })}
              onMove={(from, to) =>
                void reorder({
                  leagueId: league.id,
                  teamIds: move(
                    league.teams.map((t) => t.id),
                    from,
                    to,
                  ),
                })
              }
            />
          </div>
        )}

        {!listLocked && !readOnly && (
          <AddTeam
            onAdd={(name) =>
              void addTeam({
                leagueId: league.id,
                name,
                manager: null,
                // The first tint nobody is wearing, the way the wizard hands
                // them out. A team added later would otherwise be the only one
                // with no colour, in the app where colour is what tells teams
                // apart on the board — document 2 §2.
                color: freeColor(league.teams),
                isMine: false,
              })
            }
          />
        )}

        {listLocked && !readOnly && (
          <p className="mt-3 text-base text-fg-muted">{errorMessages.TEAMS_LOCKED()}</p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-title font-medium">Regolamento</h2>

        {!rulesOpen && (
          <p className="mt-2 text-base text-fg-muted">
            {readOnly ? errorMessages.LEAGUE_FROZEN() : errorMessages.RULES_LOCKED()}
          </p>
        )}

        {/* La stessa `key` delle righe squadra, e per la stessa ragione: dopo un
            rifiuto il valore che arriva dall'alto è quello di prima, quindi un
            campo che si risincronizza solo quando quel valore *cambia* resta a
            mostrare il numero appena respinto, con l'errore stampato sopra. */}
        <dl key={resync} className="mt-3 grid gap-x-6 gap-y-2 text-base sm:grid-cols-[10rem_1fr]">
          <dt className="label text-micro text-fg-muted">budget</dt>
          <dd>
            <Editable
              value={league.budget}
              min={0}
              disabled={!rulesOpen}
              onCommit={(budget) => void patchLeague({ id: league.id, budget })}
            />
          </dd>

          <dt className="label text-micro text-fg-muted">puntata minima</dt>
          <dd>
            <Editable
              value={league.minBid}
              min={1}
              disabled={!rulesOpen}
              onCommit={(minBid) => void patchLeague({ id: league.id, minBid })}
            />
          </dd>

          <dt className="label text-micro text-fg-muted">slot per ruolo</dt>
          <dd className="flex flex-wrap items-center gap-3">
            {CLASSIC_ROLES.map((role) => (
              <span key={role} className="flex items-center gap-1.5">
                <span className="text-fg-muted">{ROLE_LABELS[role]}</span>
                <Editable
                  value={league.slots[role]}
                  min={0}
                  disabled={!rulesOpen}
                  onCommit={(n) =>
                    void patchLeague({ id: league.id, slots: { ...league.slots, [role]: n } })
                  }
                />
              </span>
            ))}
            {/* Two numbers inside a sentence, so they stay inside it: a `Figure`
                around each would break the phrase into separate nodes to say
                what one class already says. `figure-column` is the role of
                document 7 §4 — Plex 500, tabular — and it is the right one at
                any size under 20px, where Archivo starts. The `text-base` on the
                `<dl>` above is still Tailwind's 14px, not §4's 13: the working
                measure moves in T25, and the role does not move with it. */}
            <span className="figure-column text-fg-muted">
              {totalSlots(league.slots)} per squadra · {league.slotsTotal} in tutto
            </span>
          </dd>

          <dt className="label text-micro text-fg-muted">modificatore di difesa</dt>
          <dd>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={league.defenseModifier}
                disabled={!rulesOpen}
                onChange={(e) =>
                  void patchLeague({ id: league.id, defenseModifier: e.target.checked })
                }
              />
              <span className="text-fg-muted">
                {league.defenseModifier ? 'attivo' : 'non attivo'}
              </span>
            </label>
          </dd>

          <dt className="label text-micro text-fg-muted">questa installazione</dt>
          <dd>
            {/* Non è fra i campi che l'invariante 16 congela: si cambia anche a
                asta avviata, perché decide solo come viene marcato l'export. */}
            <select
              className="rounded-md border border-line bg-surface px-2 py-1 text-base"
              value={league.instanceRole}
              disabled={readOnly}
              onChange={(e) =>
                void patchLeague({
                  id: league.id,
                  instanceRole: e.target.value as LeagueDetail['instanceRole'],
                })
              }
            >
              {(['admin', 'participant'] as const).map((role) => (
                <option key={role} value={role}>
                  {INSTANCE_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </dd>
        </dl>

        {warnings.length > 0 && (
          <ul className="mt-4 space-y-1">
            {warnings.map((warning) => (
              <li
                key={warning.code + ('role' in warning ? warning.role : '')}
                // Gesso e non ambra: metà di questi avvisi conta giocatori, e il
                // documento 2 §2 riserva l'ambra al denaro. Vedi Wizard.tsx.
                className="text-base text-fg"
              >
                {warningMessage(warning)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 border-t border-line pt-4">
        <p className="text-base text-fg-muted">
          {NEXT_STEP[league.status]}
          {/* Cortesia, non la regola: il servizio rifiuta comunque una lega con
              acquisti dentro, e in `closed` rifiuta e basta. */}
          {!readOnly && league.slotsFilled === 0 && (
            <>
              {' · '}
              <DeleteLeague
                league={league}
                pending={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            </>
          )}
        </p>
      </section>
    </Frame>
  )
}

/**
 * Where the life cycle of document 1 §3 goes from here, in one line.
 *
 * Written out rather than derived from `LEAGUE_TRANSITIONS`: the table holds
 * states, and a sentence built from state names would read "da qui si passa a
 * asta in corso". The table is what the services ask; this is what the reader is
 * told, and they answer to different audiences.
 */
const NEXT_STEP: Record<LeagueDetail['status'], string> = {
  setup: 'Il prossimo passo è completare il regolamento.',
  pre_auction: 'Il prossimo passo è l’asta: aprila dalla scheda Asta.',
  auction: 'L’asta è in corso: alla fine si passa alla revisione.',
  review: 'Dalla revisione si cristallizza il resoconto.',
  closed: notices.CRYSTALLISED(),
}

/**
 * Two clicks, and the first one says what goes with it.
 *
 * Offered only while the league has no purchases in it — the service refuses the
 * rest, and a button that is going to be refused should not be there. Two clicks
 * anyway, because the teams and their colours took a while to type.
 */
function DeleteLeague({
  league,
  pending,
  onConfirm,
}: {
  league: LeagueDetail
  pending: boolean
  onConfirm: () => void
}): JSX.Element {
  const [asked, setAsked] = useState(false)

  if (!asked) {
    return (
      <button className="underline underline-offset-2 hover:text-blocking" onClick={() => setAsked(true)}>
        Cancella la lega
      </button>
    )
  }

  return (
    <span>
      Vanno via {league.teamCount} {league.teamCount === 1 ? 'squadra' : 'squadre'}.{' '}
      <button
        className="underline underline-offset-2 text-blocking disabled:opacity-40"
        disabled={pending}
        onClick={onConfirm}
      >
        {pending ? 'Cancello…' : 'Cancella'}
      </button>{' '}
      <button className="underline underline-offset-2" onClick={() => setAsked(false)}>
        Annulla
      </button>
    </span>
  )
}

/**
 * The first hue of the palette nobody in this league is wearing, or the one
 * after the last used when all ten are taken — an eleventh team repeats a colour
 * rather than having none, which is the lesser of the two confusions.
 */
function freeColor(teams: LeagueDetail['teams']): string {
  const taken = new Set(teams.map((t) => t.color?.toLowerCase()))
  const free = TEAM_COLORS.find((tint) => !taken.has(tint.value.toLowerCase()))
  return (free ?? TEAM_COLORS[teams.length % TEAM_COLORS.length]).value
}

/** A name, then Enter. Nothing is created empty, so nothing is ever "Squadra 4". */
function AddTeam({ onAdd }: { onAdd: (name: string) => void }): JSX.Element {
  const [name, setName] = useState('')

  const add = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    onAdd(trimmed)
    setName('')
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        className="w-48 rounded-md border border-line bg-surface px-2 py-1 text-base"
        value={name}
        placeholder="nome squadra"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <button
        className="rounded-md border border-line px-3 py-1.5 text-base text-fg-muted hover:text-fg disabled:opacity-40"
        disabled={name.trim() === ''}
        onClick={add}
      >
        Aggiungi squadra
      </button>
    </div>
  )
}

/**
 * A figure that commits on blur or Enter, so one transaction per change.
 *
 * **A field, not a `Figure`**, so the component cannot draw it: the value lives
 * in the `value` of an `<input>`, and a component would have to replace the
 * input to render it. The numeric treatment is therefore `figure-column` written
 * by hand — the column role of document 7 §4, Plex 500 tabular, and not the
 * large Archivo one: Archivo enters at 20px and this field is nowhere near it.
 * The `text-base` below is §4's 13px working measure, which T25 mapped onto
 * Tailwind's name; the role is the same on either side of that move.
 * Same reasoning, same class, as `PriceField`.
 *
 * **And no amber**, even though budget and puntata minima are credits: §9 gives
 * the amber exactly one interactive element in the whole application, the price
 * field of the assignment panel. This same component also edits the slots per
 * role, which are counts and not money, so the colour could not be its own
 * anyway.
 */
function Editable({
  value,
  min,
  disabled,
  onCommit,
}: {
  value: number
  min: number
  disabled: boolean
  onCommit: (value: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    const parsed = window.Number(draft)
    if (!Number.isFinite(parsed) || draft.trim() === '') return setDraft(String(value))
    const bounded = Math.max(min, Math.trunc(parsed))
    if (bounded !== value) onCommit(bounded)
    setDraft(String(bounded))
  }

  return (
    <input
      type="number"
      className="figure-column w-24 rounded-md border border-line bg-surface px-2 py-1 text-base disabled:opacity-50"
      value={draft}
      min={min}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(String(value))
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * The fields `team.update` takes are the fields the rows edit, minus the ones the
 * shared component does not know about. Spelled out rather than spread, so a
 * field added to the rows has to be answered for here too.
 */
function toPatch(patch: Partial<TeamFields>): Omit<Input<'team.update'>, 'id'> {
  return {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.manager !== undefined && { manager: patch.manager }),
    ...(patch.color !== undefined && { color: patch.color }),
    ...(patch.isMine !== undefined && { isMine: patch.isMine }),
  }
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
}
