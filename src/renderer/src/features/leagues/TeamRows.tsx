import { useEffect, useRef, useState } from 'react'
import Figure from '@/components/Figure'
import { TEAM_COLORS } from '@shared/domain'

/**
 * The team rows of document 2 §4.3, step 2: "nome squadra, allenatore, colore
 * (da una palette predefinita di dieci tinte distinguibili), checkbox 'questa è
 * la mia'. Ordine trascinabile, definisce il turno."
 *
 * One component for the wizard and for the teams section of an existing league,
 * because they are the same table twice: the wizard patches an array in memory,
 * the league sends `team.update`. Written twice they would drift on the small
 * things — where the colour sits, whether the order starts at 1 — and the two
 * are looked at minutes apart.
 *
 * Text commits on blur or Enter, not on every keystroke: in the league it is a
 * transaction per commit, and a name typed letter by letter would be eleven of
 * them, ten of which briefly claim a team is called "B".
 *
 * `live` turns that off, and the wizard sets it. There the rows are an array in
 * memory, so there is nothing to save — and waiting for the blur costs
 * something instead: the last name typed is still uncommitted while "Crea lega"
 * is still disabled for want of it, and a click that lands between the blur and
 * the re-render is a button that visibly does nothing.
 *
 * The drag is the browser's own, with no library: rows are few, the gesture is
 * one axis, and `move()` in shared/domain.ts already does the arithmetic. Two
 * arrows do the same job for the keyboard, because HTML drag and drop has none.
 */

export type TeamFields = {
  name: string
  manager: string | null
  color: string | null
  isMine: boolean
}

type Row = TeamFields & { key: string | number }

type Props = {
  rows: readonly Row[]
  onPatch: (index: number, patch: Partial<TeamFields>) => void
  onRemove: (index: number) => void
  onMove: (from: number, to: number) => void
  /** Invariant 9: the list is settled once the auction starts. Names still change. */
  locked?: boolean
  /** Invariant 13: a crystallised league is read-only, cosmetics included. */
  frozen?: boolean
  /** Hand text over as it is typed. The wizard, where nothing is being saved. */
  live?: boolean
}

export default function TeamRows({
  rows,
  onPatch,
  onRemove,
  onMove,
  locked = false,
  frozen = false,
  live = false,
}: Props): JSX.Element {
  const dragging = useRef<number | null>(null)

  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((row, index) => (
        <li
          key={row.key}
          draggable={!locked && !frozen}
          onDragStart={() => (dragging.current = index)}
          onDragEnd={() => (dragging.current = null)}
          onDragOver={(e) => {
            if (dragging.current !== null && dragging.current !== index) e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging.current !== null) onMove(dragging.current, index)
            dragging.current = null
          }}
          className="flex h-9 items-center gap-2 px-2"
        >
          {/* The turn, and the handle you drag to change it. `Figure` draws the
              number; the span around it stays because it is the handle — it
              carries the grab cursor and the hint, and neither of those is
              something a figure knows about. */}
          <span
            className={`w-6 text-right text-base text-fg-muted ${
              locked || frozen ? '' : 'cursor-grab'
            }`}
            title={locked || frozen ? undefined : 'Trascina per cambiare il turno'}
          >
            <Figure value={index + 1} />
          </span>

          <Swatch
            color={row.color}
            disabled={frozen}
            onPick={(color) => onPatch(index, { color })}
          />

          <Text
            value={row.name}
            placeholder="nome squadra"
            disabled={frozen}
            live={live}
            className="w-48"
            onCommit={(name) => onPatch(index, { name })}
          />

          <Text
            value={row.manager ?? ''}
            placeholder="allenatore"
            disabled={frozen}
            live={live}
            className="w-40"
            onCommit={(manager) => onPatch(index, { manager: manager === '' ? null : manager })}
          />

          <label className="ml-auto flex items-center gap-1.5 text-base text-fg-muted">
            <input
              type="checkbox"
              checked={row.isMine}
              disabled={frozen}
              onChange={(e) => onPatch(index, { isMine: e.target.checked })}
            />
            la mia
          </label>

          <div className="flex items-center gap-0.5">
            <Arrow
              label="Sposta su"
              glyph="↑"
              disabled={locked || frozen || index === 0}
              onClick={() => onMove(index, index - 1)}
            />
            <Arrow
              label="Sposta giù"
              glyph="↓"
              disabled={locked || frozen || index === rows.length - 1}
              onClick={() => onMove(index, index + 1)}
            />
            <button
              className="px-1.5 py-0.5 text-base text-fg-muted hover:text-blocking disabled:opacity-30 disabled:hover:text-fg-muted"
              disabled={locked || frozen}
              title={locked ? 'Le squadre si tolgono prima dell’asta' : 'Togli la squadra'}
              aria-label={`Togli ${row.name || 'la squadra'}`}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * A text field that keeps what is being typed and hands it over on blur or
 * Enter. Escape puts back what was there, which is the only way out of a
 * half-typed name that does not commit it.
 */
function Text({
  value,
  placeholder,
  className,
  disabled,
  live,
  onCommit,
}: {
  value: string
  placeholder: string
  className?: string
  disabled?: boolean
  live?: boolean
  onCommit: (value: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value)

  // The row can change underneath: a refused update rolls back, and another
  // window can rename the same team. Whatever the database says wins.
  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed !== value) onCommit(trimmed)
  }

  return (
    <input
      className={`rounded-md border border-line bg-surface px-2 py-1 text-base disabled:opacity-50 ${className ?? ''}`}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value)
        // Live: the value as typed, untrimmed — trimming mid-word would eat the
        // space between "I" and "Fenomeni". What is written is trimmed by the
        // contract on the way out, and by `commit` on the way past a blur.
        if (live) onCommit(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** The ten hues, opened from the square that shows the current one. */
function Swatch({
  color,
  disabled,
  onPick,
}: {
  color: string | null
  disabled?: boolean
  onPick: (color: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        className="block size-5 rounded-sm border border-line disabled:opacity-50"
        style={{ backgroundColor: color ?? 'transparent' }}
        disabled={disabled}
        aria-label={color ? `Colore ${labelOf(color)}` : 'Scegli un colore'}
        onClick={() => setOpen((o) => !o)}
      />

      {open && (
        <div className="absolute left-0 top-6 z-10 flex w-40 flex-wrap gap-1 rounded-lg border border-line bg-surface-panel p-2 shadow-overlay">
          {TEAM_COLORS.map((tint) => (
            <button
              key={tint.value}
              className={`size-5 rounded-sm border ${
                tint.value === color ? 'border-fg' : 'border-line'
              }`}
              style={{ backgroundColor: tint.value }}
              aria-label={tint.label}
              title={tint.label}
              onClick={() => {
                onPick(tint.value)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function labelOf(color: string): string {
  return TEAM_COLORS.find((c) => c.value.toLowerCase() === color.toLowerCase())?.label ?? color
}

function Arrow({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className="px-1 py-0.5 text-base text-fg-muted hover:text-fg disabled:opacity-30 disabled:hover:text-fg-muted"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {glyph}
    </button>
  )
}
