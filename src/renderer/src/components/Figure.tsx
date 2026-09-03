import { show, type FigureKind } from '@/lib/format'
import { useCountUp } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * A number, document 7 §10: "componente dedicato, perché i numeri sono il
 * contenuto". No figure in this application is written by hand inside a
 * `<span>` any more.
 *
 * ## It picks the family from the size, which is the whole point
 *
 * §4 does not give one typeface for numbers, it gives **three roles**, and each
 * changes family, weight, width axis and leading together: Plex 500 in a column,
 * Archivo 600 at width 112 for a large figure, Archivo 700 at width 125 on the
 * projection. Archivo starts at 20px — below that its tabular figures are not
 * guaranteed across the weight × width matrix, and the place they are actually
 * needed is the 13px column.
 *
 * The `.figures` class this replaces wore **one** of the three, the projection's,
 * in all 63 of its call sites — including columns at 12 and 14px, which is
 * precisely what §15 forbids. That was not an oversight: T22 could not split it
 * without touching 63 components, which is the one thing its own criterion
 * ruled out, and its comment in `base.css` says so and sends the work here.
 *
 * ## `inherit` is the default and it is deliberate
 *
 * Most of the 63 sites declare no size at all and take one from their row. Given
 * an explicit `--num-sm` they would each shift by a pixel or two against text
 * that has not moved yet, because the working measure is still Tailwind's 14px
 * until T25 brings it to §4's 13. So `inherit` changes the family, the weight
 * and the tabular figures — the part that is wrong today — and leaves the size
 * where the row put it. Only the figures §10 sizes by name take a token.
 *
 * ## It counts, but only where §7 says
 *
 * §7 closes the list of animations at four and names one figure: "la cifra dei
 * crediti che conta al nuovo valore, 200ms, quando cambia". So `money` counts
 * and the rest do not — and it could not be otherwise, since `useCountUp`
 * rounds every intermediate frame and a fantamedia counting through whole
 * numbers would be a worse lie than not moving. Never on first mount: the hook
 * starts with the current value, so there is nothing to travel.
 */
export default function Figure({
  value,
  kind = 'whole',
  size = 'inherit',
  role,
  animate,
  className,
}: {
  value: number | null | undefined
  kind?: FigureKind
  size?: Size
  /** Only for the projection, which owns its own scale in `--proj-*` until T24
   *  rewrites it: there the size comes from a media query and cannot be one of
   *  the four tokens, but the family still has to be the projection's. */
  role?: Role
  animate?: boolean
  className?: string
}): JSX.Element {
  const moving = animate ?? kind === 'money'
  const counted = useCountUp(value ?? 0)
  const shown = moving && value !== null && value !== undefined ? counted : value

  return (
    <span
      className={cn(
        ROLE_CLASS[role ?? ROLE_OF[size]],
        size !== 'inherit' && SIZE_CLASS[size],
        kind === 'money' && 'text-money',
        className,
      )}
    >
      {show(shown, kind)}
    </span>
  )
}

type Size = 'inherit' | 'sm' | 'md' | 'lg' | 'xl'
type Role = 'column' | 'large' | 'projection'

/** §4's four figure sizes. Consumed as an arbitrary length because `--num-*` is
 *  not a Tailwind namespace — see the block that declares them in `base.css`. */
const SIZE_CLASS: Record<Exclude<Size, 'inherit'>, string> = {
  sm: 'text-[length:var(--num-sm)]',
  md: 'text-[length:var(--num-md)]',
  lg: 'text-[length:var(--num-lg)]',
  xl: 'text-[length:var(--num-xl)]',
}

/** Archivo enters at 20px, so the boundary between the roles is the boundary
 *  between `sm` and `md`. */
const ROLE_OF: Record<Size, Role> = {
  inherit: 'column',
  sm: 'column',
  md: 'large',
  lg: 'large',
  xl: 'projection',
}

const ROLE_CLASS: Record<Role, string> = {
  column: 'figure-column',
  large: 'figure-large',
  projection: 'figure-projection',
}
