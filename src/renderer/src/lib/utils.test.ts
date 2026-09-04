import { describe, expect, it } from 'vitest'
import { cn } from './utils'

/**
 * `cn` is pure, touches neither Node nor the DOM, and guards a failure that
 * shows nothing: see the reasoning in utils.ts. Same exception document 6 §7
 * grants `search.ts` — it lives in the renderer and the guardrail of §5 does not
 * reach it.
 *
 * Without the extension, `cn('text-micro', 'text-fg-muted')` returns
 * `'text-fg-muted'` and the size is gone; reverse the arguments and the colour
 * goes instead. Both directions are here on purpose, because a test written in
 * one order only would have passed against the broken version half the time.
 */
describe('cn keeps the size tokens of document 7 §4', () => {
  it.each([
    ['text-micro', 'text-fg-muted'],
    ['text-body', 'text-fg'],
    ['text-title', 'text-money'],
    ['text-heading', 'text-fg-strong'],
  ])('keeps %s next to %s, in both orders', (size, colour) => {
    expect(cn(size, colour).split(' ').sort()).toEqual([size, colour].sort())
    expect(cn(colour, size).split(' ').sort()).toEqual([size, colour].sort())
  })

  it('keeps an arbitrary figure length next to a colour', () => {
    expect(cn('text-[length:var(--num-md)]', 'text-money')).toBe(
      'text-[length:var(--num-md)] text-money',
    )
  })
})

/**
 * The other half, and the one that would break if the extension were written too
 * greedily: teaching tailwind-merge that `text-micro` is a size is only correct
 * if two sizes still collide, and if two colours still collide.
 */
describe('cn still resolves the conflicts it is there for', () => {
  it('keeps the last of two sizes', () => {
    expect(cn('text-micro', 'text-body')).toBe('text-body')
    expect(cn('text-sm', 'text-micro')).toBe('text-micro')
    expect(cn('text-heading', 'text-lg')).toBe('text-lg')
  })

  it('keeps the last of two colours', () => {
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted')
    expect(cn('text-money', 'text-blocking')).toBe('text-blocking')
  })
})
