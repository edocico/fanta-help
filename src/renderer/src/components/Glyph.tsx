import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A mark that carries its own word — the ◉ of a penalty taker, the `fuori` of a
 * delisted player.
 *
 * Not one of the five primitives T23 asks for, and here anyway because two rules
 * of document 7 need a mechanism and neither had one. §15: "non usare
 * l'attributo `title` nativo per spiegare una sigla, **né per nient'altro**" —
 * and `title` is how these marks were explained, with a delay nobody controls,
 * drawn by the operating system, and invisible to a keyboard. Three of them were
 * converted when this was written — the penalty mark and the two `fuori` of the
 * players and review tables — and twenty-five others were left standing and
 * counted here, so that a number like that would get noticed instead of
 * absorbed.
 *
 * **T25 took all twenty-five out, and only four of them needed this component.**
 * Twelve were pure duplication: the element already carried an `aria-label` with
 * the same words, so the `title` gave nothing to a screen reader and gave a
 * system tooltip to everyone else. Seven were full names behind a `truncate`,
 * and those stay truncated — §15 has no exception, and inventing a popover for
 * every clipped name in a list is the thing §10 warns about one line later. Two
 * were keyboard shortcuts hidden in a tooltip that never opens on focus, which
 * is exactly the reader who is hunting for them: §10 wants those *visible*, and
 * now they are. The rest became words on the page or in an `sr-only`.
 *
 * There are now **zero** native `title` attributes under `src/renderer`. The
 * four that became this component are the penalty mark, the two `fuori` of the
 * players and review tables, and the `fuori listone` of the roster grid — the
 * one this docblock had named and left standing.
 *
 * §12: "mai il colore da solo", which a bare glyph in a colour is exactly.
 *
 * `Abbr` cannot do this job: its `name` must be a glossary key, and these are
 * not abbreviations — they are marks, and their words are the sentence that
 * explains them rather than an expansion.
 */
export default function Glyph({
  mark,
  says,
  className,
}: {
  mark: ReactNode
  says: string
  className?: string
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn('ml-1.5 text-fg-muted', className)}>
          <span aria-hidden>{mark}</span>
          <span className="sr-only">{says}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-base text-fg">{says}</p>
      </TooltipContent>
    </Tooltip>
  )
}
