import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * The data table of document 7 §10 — consultation, objectives, plans, review.
 *
 * Parts and not one component, because one of the three tables in the app is
 * virtualized: the players view owns its scrolling container, its `tbody` and
 * the two spacer rows that keep the scrollbar honest about six hundred rows
 * while the DOM holds twenty. A wrapper with `overflow-x-auto` — which is what
 * the shadcn primitive gave, and the reason its docblock said the players table
 * did not use it — takes all three away. Parts let the same rules dress a table
 * that scrolls itself and one that does not.
 *
 * | Property | §10 | Before |
 * |---|---|---|
 * | Row height | 40px | never declared: ~59, ~38 and ~22 in the three tables |
 * | Header | 32px, sticky | sticky in two, **16px** in both, height undeclared |
 * | Separator | 1px `--line` | `border-line/50` |
 * | Alternating rows | `--surface-raised` at 40% | absent |
 * | Hover | `--surface-raised` | `pitch-800`, one step short |
 * | Cell padding | 8px | 12px, 8px and 0 |
 *
 * The 16px headings are worth a line of their own, because nothing in the
 * markup said 16: `label` carries weight and letter-spacing and no size, no
 * ancestor declared one, and there was no `font-size` on `html` or `body` at
 * all. So every heading in this app was rendering *larger* than the cells
 * beneath it, which is the opposite of §10, and no reading of a component would
 * show it. T25 closed both halves — `body` now carries §4's 13px working
 * measure, and every `label` site declares `text-micro` — so the number a
 * heading renders at is written somewhere a reader can find it.
 */
export function DataTable({ className, ...props }: ComponentProps<'table'>): JSX.Element {
  return <table className={cn('w-full border-collapse', className)} {...props} />
}

/** 32px and sticky, "sempre", §5. The background is opaque or the rows scroll
 *  through it. */
export function DataTableHead({ className, ...props }: ComponentProps<'thead'>): JSX.Element {
  return <thead className={cn('sticky top-0 z-10 bg-surface', className)} {...props} />
}

export function DataTableHeadRow({ className, ...props }: ComponentProps<'tr'>): JSX.Element {
  return <tr className={cn('h-8', className)} {...props} />
}

/** 11px in `--text-muted`, sentence case, never spaced capitals (§4). */
export function DataTableHeadCell({
  numeric = false,
  className,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }): JSX.Element {
  return (
    <th
      className={cn(
        'label border-b border-line px-2 text-micro font-medium text-fg-muted',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  )
}

export function DataTableBody(props: ComponentProps<'tbody'>): JSX.Element {
  return <tbody {...props} />
}

/**
 * 40px, and the zebra comes from `index` rather than from `odd:`.
 *
 * CSS parity would be wrong exactly where it matters: the players table puts a
 * spacer `<tr>` before the first real row, so `nth-child` counts from the wrong
 * foot and the stripes would invert as you scroll. The logical index is
 * something every caller already has — it is the row it is mapping — and passing
 * it means the stripes cannot drift.
 *
 * `taken` and `unavailable` from §10 are deliberately not here. The players view
 * still knows nothing about purchases (a leftover from T13: the comment in
 * `PlayersView` promises the state and no `owners` ever arrived) and
 * unavailability is T19. A row state no caller can reach is a guard that never
 * fires, and this codebase has a rule about those.
 */
export function DataTableRow({
  index,
  selected = false,
  className,
  ...props
}: ComponentProps<'tr'> & { index: number; selected?: boolean }): JSX.Element {
  return (
    <tr
      className={cn(
        'h-10 border-b border-line',
        index % 2 === 1 && 'bg-surface-raised/40',
        selected
          ? 'border-l-2 border-l-ring bg-surface-raised'
          : 'hover:bg-surface-raised',
        className,
      )}
      {...props}
    />
  )
}

/** 8px horizontal. Numbers to the right; the figures themselves are tabular
 *  because they come from `Figure`, which has no other setting. */
export function DataTableCell({
  numeric = false,
  className,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean }): JSX.Element {
  return <td className={cn('px-2', numeric && 'text-right', className)} {...props} />
}

/** The 6px dot of §10, "nella tua lista", before the name. Never colour alone:
 *  §12 requires a second signal, and the row keeps the star column that says the
 *  same thing in words and in a rating. */
export function TargetedDot({ className }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('mr-1.5 inline-block size-1.5 shrink-0 rounded-full bg-targeted', className)}
    />
  )
}
