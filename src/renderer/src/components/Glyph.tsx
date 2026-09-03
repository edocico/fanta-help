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
 * and `title` was how every one of these marks was explained, with a delay
 * nobody controls, drawn by the operating system, and invisible to a keyboard.
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
        <span tabIndex={0} className={cn('ml-1.5 text-chalk-dim', className)}>
          <span aria-hidden>{mark}</span>
          <span className="sr-only">{says}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-[13px] text-chalk">{says}</p>
      </TooltipContent>
    </Tooltip>
  )
}
