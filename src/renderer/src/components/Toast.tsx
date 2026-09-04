import { useEffect, useRef } from 'react'

/**
 * The toast of document 2 §5: "compare un toast in basso — 'Lautaro Martinez →
 * Real Fanta, 47 crediti' — con Annulla, che resta dieci secondi".
 *
 * It is the visible half of the third principle of §1, "annullare invece di
 * confermare": the purchase is already written when this appears. So the button
 * is not a way out of a pending action, it is a second chance at a finished one
 * — which is why `Ctrl/Cmd+Z` goes on working after the ten seconds are up, and
 * why nothing here is disabled while the undo is in flight.
 *
 * No focus is taken and no role="alert" is set. §1 forbids modals during the
 * auction, and a live region announcing every purchase would talk over whoever
 * is calling the next player. It is `status`: read if asked, never interrupting.
 */
export const TOAST_MS = 10_000

export default function Toast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string
  onUndo: () => void
  onDismiss: () => void
}): JSX.Element {
  /**
   * Ten seconds, started once, restarted only by the caller's `key`.
   *
   * The dependency list is empty and the callback is held in a ref, and the two
   * go together. With `[onDismiss]` the timer restarted on **every render of the
   * parent**, because the caller passes a fresh arrow each time: measured at
   * eighteen seconds and still on screen, against the ten §5 asks for. The
   * comment that stood here claimed the key was what restarted it and the deps
   * were what kept it honest; it was the other way round. The key does remount
   * the component on a new purchase, which is exactly and only when the ten
   * seconds should begin again.
   */
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss.current(), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-4 rounded-md border border-line bg-pitch-700 px-4 py-2 text-base shadow-none"
    >
      <span className="text-chalk">{message}</span>
      {/*
        Not `text-credit`. Document 2 §2: "L'ambra è riservata al denaro. Se un
        numero è ambra è un credito. Nient'altro usa quel colore, mai per
        decorazione." This is the label of an action, and the toast already
        carries one legitimate amber figure inside its message — two ambers of
        which one is not money is precisely the reading the rule protects.
      */}
      <button className="label text-micro text-chalk hover:underline" onClick={onUndo}>
        Annulla
      </button>
      <button
        className="label text-micro text-chalk-dim hover:text-chalk"
        aria-label="chiudi l’avviso"
        title="chiudi"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}
