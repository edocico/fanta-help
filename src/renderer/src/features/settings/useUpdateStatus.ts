import { useEffect, useState } from 'react'
import { call, subscribe } from '@/lib/ipc'
import type { UpdateStatus } from '@shared/contracts'

/**
 * Lo stato dell'aggiornamento, T20.
 *
 * Un gancio e non due copie perché i lettori sono due e distanti: la sezione
 * Aggiornamenti, che li disegna tutti, e il pallino nella barra laterale, che
 * guarda solo se lo stato è `ready`. Scritti separatamente, il giorno che la
 * sequenza cambia ne cambierebbe uno solo — e il pallino è quello che nessuno
 * riguarda, perché è giusto quasi sempre.
 *
 * **Il primo consumatore di `subscribe` in tutta l'applicazione.** Il canale
 * c'è da T7 per `dataset.progress`, ma nessun componente lo aveva mai usato:
 * l'import mostra l'avanzamento dalla propria richiesta.
 */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    /**
     * Ci si iscrive **prima** di chiedere, e la risposta si scarta se nel
     * frattempo è arrivata una spinta.
     *
     * I due versi dell'ordine sbagliato sono entrambi rotti. Chiedendo prima di
     * iscriversi si perde ogni cambiamento avvenuto nel mezzo — e nel mezzo c'è
     * una richiesta IPC, cioè esattamente il tempo in cui l'updater risponde.
     * Iscrivendosi prima ma applicando comunque la risposta, una risposta lenta
     * sovrascrive uno stato più nuovo con uno più vecchio: si vedrebbe il
     * pallino accendersi e spegnersi da solo.
     */
    let pushed = false
    const off = subscribe('update.status', (next) => {
      pushed = true
      setStatus(next)
    })
    void call('update.state').then(
      (current) => {
        if (!pushed) setStatus(current)
      },
      // Un errore qui non ha niente da dire a nessuno: vuol dire che il
      // database non si è aperto, e in quel caso lo schermo porta già il suo
      // messaggio. Lo stato resta `idle`, che è il vero.
      () => {},
    )
    return off
  }, [])

  return status
}
