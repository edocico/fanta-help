import { cn } from '@/lib/utils'
import { ROLE_LABELS_ONE, type ClassicRole } from '@shared/domain'

/**
 * A Classic role, document 7 §10: an 18px square, 11px at weight 600, on
 * `--surface-raised`. **Neutral**, and that is a decision with a reason.
 *
 * The Mantra colours — yellow keeper, green defence, blue midfield, purple
 * trequarti, red attack — were considered and dropped. It is a real convention
 * that players already read on the listone, but it is five more colours
 * competing with the ten club tints and with the amber, in a table where the
 * role is already filtered and already written. The convention is not worth the
 * noise.
 *
 * Nothing has to be undone to get here: no per-role colour ever entered this
 * codebase. Today the role is a bare letter in `--text-muted` in thirteen
 * places, so §10 is asking for a shape where there is only text.
 *
 * The letter carries its word for screen readers, and it is `ROLE_LABELS_ONE`
 * and not `ROLE_LABELS`: the badge names the role of **one** player, and the
 * plural list would have it read "portieri". Both objects already exist for this
 * exact reason, and holding the word a third time here is how the copies would
 * come apart.
 *
 * The Mantra roles deliberately have no badge: there are up to three of them and
 * they would fill the row, so §10 keeps them as 11px text in `--text-muted`
 * under the name — which is what `PlayersView` already does.
 */
export default function RoleBadge({
  role,
  className,
}: {
  /** `ClassicRole` and not `string`: with `string` the lookup needed a cast and
   *  left a branch for a letter with no word, which neither caller can reach —
   *  a guard that never fires. Typed, a Mantra role does not compile here, which
   *  is what §10 asks this component to prevent. */
  role: ClassicRole
  className?: string
}): JSX.Element {
  const spelled = ROLE_LABELS_ONE[role]
  return (
    <span
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-badge bg-surface-raised text-micro font-semibold text-chalk',
        className,
      )}
    >
      <span aria-hidden>{role}</span>
      <span className="sr-only">{spelled}</span>
    </span>
  )
}
