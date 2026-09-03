import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The four size tokens document 7 §4 adds have to be declared here or they do
 * not survive `cn`.
 *
 * tailwind-merge sorts a `text-*` class by validator: `text-sm` matches its
 * t-shirt-size test and lands in the `font-size` group, while `text-micro`
 * matches nothing and falls through to `text-color`, which accepts anything.
 * Two classes in the same group are a conflict and the loser is dropped — so
 * `cn('text-micro', 'text-chalk-dim')` returns `text-chalk-dim` alone and
 * `cn('text-chalk-dim', 'text-micro')` returns `text-micro` alone. Measured on
 * the installed package, both directions, before writing this.
 *
 * It is the worst shape of failure this codebase keeps meeting: the class is
 * written, the token exists, the build emits the rule, and the element renders
 * at the size it already had. Nothing fails, and which half disappears depends
 * on the order the arguments happened to be in.
 *
 * The `--num-*` figures of §4 are not here and do not need to be: they are
 * consumed as `text-[length:var(--num-md)]`, and an arbitrary *length* is
 * classified correctly on its own — verified alongside the cases above.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'body', 'title', 'heading'] }],
    },
  },
})

/** Merges class lists and resolves conflicting Tailwind utilities. Every shadcn
 *  component imports this; the CLI expects it at exactly this path. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
