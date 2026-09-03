import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A filter, document 7 §10: 24px tall, fully rounded, 11px at weight 500.
 *
 * The full radius is the only one in the application and §6 says why: the shape
 * says "removable". Everything else — rows, cells, panels — is square or nearly.
 *
 * Active it fills with `--surface-raised` and carries the ✕ that takes it off;
 * inactive it is an outline in `--line`. One component for both populations of
 * the players view: the preset toggles in the filter bar, and the row of active
 * filters underneath, which until now was a second, differently-shaped kind of
 * pill built inline.
 *
 * The size is the visible half of a defect §10 did not predict. `label` sets
 * weight and letter-spacing and no size, nothing above these chips declares one
 * either, and there is no `font-size` on `html` or `body` — so every chip in the
 * bar was rendering at the browser's 16px, larger than the 14px cells of the
 * table below it. `text-micro` is 11px and closes it.
 */
export default function FilterChip({
  active,
  onToggle,
  children,
  className,
}: {
  active: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <button
      className={cn(
        'label inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-micro',
        active
          ? 'bg-surface-raised text-chalk'
          : 'border border-line text-chalk-dim hover:text-chalk',
        className,
      )}
      onClick={onToggle}
    >
      {children}
      {/* Hidden from the reader of the label, which would otherwise end in a
          multiplication sign: the button already says what it does. */}
      {active && <span aria-hidden>✕</span>}
    </button>
  )
}
