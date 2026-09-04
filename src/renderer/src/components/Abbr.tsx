import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDense } from '@/lib/league'
import { cn } from '@/lib/utils'
import { glossary, type Abbr as AbbrName } from '@shared/glossary'

/**
 * An abbreviation, drawn once and explained where it is defined — document 7
 * §10. `name` is typed as a key of the glossary, so an abbreviation without an
 * entry does not compile: it is the same discipline as the IPC contracts, the
 * compiler preventing a divergence rather than someone noticing it.
 *
 * At rest it wears nothing. No dotted underline: fifteen dotted underlines in
 * one header row are noise, and §10 says so. The underline appears under the
 * pointer, the popover 600ms later — long enough that crossing the table shows
 * nothing and only stopping does. From the keyboard both are immediate, which
 * costs no code: Radix opens on focus without consulting the delay.
 *
 * ## The two shapes, and why there are two
 *
 * Most of the time the abbreviation is the whole of what is drawn — a `<th>`, a
 * `<dt>`, a label — and `Abbr` renders its own focusable span.
 *
 * In the players table it is not: the column heading is already a button that
 * sorts. Nesting a focusable span inside a button is two tab stops on one word
 * and a nesting no screen reader should be handed, and hanging the popover on a
 * span the keyboard cannot reach would drop the whole focus row of §10 in the
 * densest table of the app — the one place where learning the abbreviations
 * matters most. So `children` is a render prop: the caller's own element becomes
 * the trigger, and gets the label and the classes that go with it.
 *
 *     <Abbr name="FM">
 *       {(label, className) => (
 *         <button className={cn(className, 'hover:text-fg')} onClick={sort}>
 *           {label} ↑
 *         </button>
 *       )}
 *     </Abbr>
 *
 * ## It goes dark in the auction
 *
 * §10: during the auction the visible abbreviations are only the role letters
 * and the club codes, of little value, and a board of 250 cells must not light
 * popovers as the pointer crosses it. The hidden expansion stays either way —
 * with the popover gone it is the only thing a screen reader is left with, which
 * is the real reason §10 asks for it separately from the tooltip.
 */
export default function Abbr({
  name,
  className,
  children,
}: {
  name: AbbrName
  className?: string
  children?: (label: ReactNode, className: string) => ReactElement
}): JSX.Element {
  const entry = glossary[name]
  const dense = useDense()

  const label = (
    <>
      {name}
      <span className="sr-only"> — {entry.full}</span>
    </>
  )

  if (dense) {
    return children ? children(label, className ?? '') : <span className={className}>{label}</span>
  }

  const decorated = cn(TRIGGER, className)
  const trigger = children ? (
    children(label, decorated)
  ) : (
    <span tabIndex={0} className={decorated}>
      {label}
    </span>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      {/* §10: "Esteso in `--text` a 13px peso 500, spiegazione in `--text-muted`
          a 12px". T25 closed the scale, so the two arbitrary lengths that stood
          here until the names existed are now the names themselves. */}
      <TooltipContent>
        <p className="text-base font-medium text-fg">{entry.full}</p>
        <p className="mt-1 text-sm text-fg-muted">{entry.explains}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A 1px dotted underline in `--text-muted`, on the pointer and on the keyboard.
 * On the trigger and never on the label, so that the render-prop form needs no
 * `group` on the caller's element: a coupling that silently loses the underline
 * when someone forgets it is exactly the kind of defect this file exists to
 * avoid.
 */
const TRIGGER =
  'underline-offset-2 decoration-dotted decoration-1 decoration-[color:var(--text-muted)] hover:underline focus-visible:underline'
