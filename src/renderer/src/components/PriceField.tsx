import { useEffect, useState } from 'react'

/**
 * A small number that is edited in place: the maximum price of an objective, the
 * estimated price of a plan cell.
 *
 * Shared by the board and the grid rather than written twice, and it carries the
 * two lessons T11 paid for.
 *
 * **It commits on Enter as well as on blur.** A field that only delivers on blur
 * has two ways to lie, and the CLAUDE.md table describes both: a button that
 * depends on the value is still disabled while the blur is happening, and a
 * refused write leaves the parent holding the old value — so the effect below
 * does not fire and the field goes on showing what was just rejected. Enter is
 * the way out of the first; the `key` the caller changes on a refusal is the way
 * out of the second.
 *
 * **It truncates.** `type="number"` accepts `40,5` and every price it feeds is a
 * `z.number().int()`, so without this the answer is "Richiesta non valida" with
 * no field named.
 */
export default function PriceField({
  value,
  onCommit,
  label,
  placeholder = '—',
  disabled = false,
  className = '',
}: {
  value: number | null
  /** Null when the field is emptied: a price that was set and no longer is. */
  onCommit: (next: number | null) => void
  /** For screen readers and the title: "prezzo massimo di Lautaro Martinez". */
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value === null ? '' : String(value))

  // Follows the value from above when it actually changes — a price written by
  // another screen, or the cache answering. On a refusal it does not change, and
  // that is exactly the case the caller's `key` covers.
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])

  function commit(): void {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== null) onCommit(null)
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    const next = Math.max(0, Math.trunc(parsed))
    if (next !== value) onCommit(next)
    else setDraft(String(next))
  }

  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`figures w-14 rounded-md border border-line bg-pitch-900 px-1 py-0.5 text-right text-sm text-credit disabled:opacity-40 ${className}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') setDraft(value === null ? '' : String(value))
      }}
    />
  )
}
