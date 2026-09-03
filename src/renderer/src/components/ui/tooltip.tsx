/**
 * Primitiva shadcn su Radix, generata a mano e non dalla CLI, per due ragioni
 * che il file generato non avrebbe rispettato.
 *
 * **Niente animazione.** La CLI emette `animate-in fade-in-0 zoom-in-95` e le
 * varianti `data-[side=…]:slide-in-from-*`, che vengono dal pacchetto
 * `tw-animate-css`. Qui non c'è, quindi Tailwind non genererebbe niente per
 * quelle classi: nessun errore, nessuna regola, un popover che appare secco — la
 * stessa forma della trappola «utility assente dal CSS costruito», e la si
 * scoprirebbe solo confrontando col sito di shadcn. Il §7 del documento 7 chiude
 * comunque la porta: quattro animazioni in tutta l'applicazione, e «non se ne
 * aggiungono senza toglierne una». Secco è quello che vogliamo.
 *
 * **Nessun Provider dentro `Tooltip`.** La CLI avvolge ogni `Tooltip` in un
 * `TooltipProvider` suo con `delayDuration={0}`, e con un provider per tooltip
 * `skipDelayDuration` non ha nessuno con cui contare: è per definizione la
 * finestra di grazia *fra tooltip diversi dello stesso provider*. Il §10 chiede
 * proprio quella — «dopo il primo popover i successivi si aprono senza attesa
 * per 300ms, così scorrere le intestazioni per impararle funziona» — quindi il
 * provider è uno solo, in cima all'applicazione, e i 600ms e i 300ms stanno lì.
 * Col file generato la riga del §10 sarebbe stata scritta, compilata, e falsa.
 */

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

/**
 * I due ritardi del §10, in un posto solo.
 *
 * `delayDuration` è l'attesa al passaggio del mouse e serve a una cosa sola:
 * attraversare la tabella non deve far apparire niente, il popover arriva solo
 * se ti fermi. Il fuoco da tastiera lo scavalca da sé — Radix apre subito su
 * `focus`, che è l'altra riga della tabella del §10 e non costa codice.
 */
function TooltipProvider({
  delayDuration = 600,
  skipDelayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>): JSX.Element {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  )
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>): JSX.Element {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
): JSX.Element {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/**
 * Superficie da pannello, raggio 6px e l'unica ombra dell'applicazione (§6).
 * Larghezza massima 240px come chiede il §10: oltre, la spiegazione smette di
 * essere una didascalia e diventa un paragrafo.
 */
function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>): JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-[240px] rounded-lg border border-line bg-popover px-3 py-2 shadow-overlay',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
