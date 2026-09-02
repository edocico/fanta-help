import { useEffect, useRef, useState } from 'react'

/**
 * The two movements document 2 §2 allows, and nothing else.
 *
 * "Solo in risposta a un'azione, e solo per mostrare cosa è cambiato." The list
 * there is closed: the row of a fresh purchase flashes once in the team's colour
 * for 400ms, the credits count from the old value to the new one in 200ms, the
 * player panel enters from the right in 150ms. This module owns the second one;
 * the first is a CSS animation in base.css, because a colour change survives
 * `prefers-reduced-motion` and a hook that respected it would have to fake that.
 */

/** §2: "`prefers-reduced-motion` disattiva tutto tranne il cambio di colore." */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const COUNT_MS = 200

/**
 * A figure that counts from its old value to its new one, "così l'occhio vede
 * che si è mosso".
 *
 * Rounded on the way, because the destination is a credit and there are no
 * halves of one. The interpolation is linear: over 200ms an easing curve is
 * three frames of difference nobody can see, and the arithmetic would be one
 * more thing between the database and the number on the wall.
 *
 * **The timeout is not a belt-and-braces backstop, it is the correctness.**
 * CLAUDE.md's table records what happens when the auction window is not in
 * front — which is the normal state while a terminal is driving it, and a real
 * one when the auction is on a second screen: `visibilityState` goes to hidden
 * and `requestAnimationFrame` stops firing entirely. Left to rAF alone the
 * figure would freeze at whatever fraction of the way it had reached, and the
 * credits column would sit there showing a number the database does not hold.
 */
export function useCountUp(value: number, ms: number = COUNT_MS): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    const start = from.current
    from.current = value

    if (start === value || prefersReducedMotion() || document.visibilityState === 'hidden') {
      setShown(value)
      return
    }

    const began = performance.now()
    let frame = 0

    function step(now: number): void {
      const t = Math.min(1, (now - began) / ms)
      setShown(Math.round(start + (value - start) * t))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)

    // Lands on the exact value whether or not a single frame ever ran.
    const settle = window.setTimeout(() => setShown(value), ms + 50)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
    }
  }, [value, ms])

  return shown
}
