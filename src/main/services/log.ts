import { auctionLog } from '../db/schema'
import type { Db } from '../db/client'

/**
 * Il registro della lega, documento 1 §3: append-only, e l'unico posto che
 * ricorda *quando* è successo qualcosa.
 *
 * In un file suo da T17, quando i lettori sono diventati due. Stava dentro
 * `auction.ts` finché l'asta era l'unica cosa che scriveva, e la cristallizzazione
 * che lo importasse da lì lo direbbe male: non è un dettaglio dell'asta, è il
 * registro della lega, e la riapertura di una lega cristallizzata ci finisce
 * dentro per obbligo dell'invariante 13 — «l'unica transizione è la riapertura,
 * registrata nel log».
 *
 * `phase` era la costante `'auction'` fino a T16. La cronologia di una lega
 * finita deve poter distinguere l'acquisto gridato al tavolo dalla correzione
 * fatta dopo con calma, e la colonna ha già il suo `check()` accanto all'enum di
 * Drizzle — che da solo non emette SQL.
 */
export function log(
  on: Pick<Db, 'insert'>,
  leagueId: number,
  phase: 'auction' | 'review',
  action: string,
  payload: unknown,
  actorUuid: string,
): void {
  on.insert(auctionLog)
    .values({
      leagueId,
      phase,
      action,
      payload: JSON.stringify(payload),
      actorUuid,
      createdAt: Date.now(),
    })
    .run()
}
