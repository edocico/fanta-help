import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Input } from '@shared/contracts'
import { canTransition, frozen, type ClassicRole } from '@shared/domain'
import { raise } from '@shared/errors'
import {
  hashOf,
  SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT_VERSION,
  type SnapshotContent,
  type SnapshotFile,
} from '@shared/snapshot'
import type { SnapshotDetail, SnapshotSummary } from '@shared/types'
import type { Db } from '../db/client'
import { log } from './log'
import {
  appInstance,
  fantaTeam,
  league,
  leagueSlot,
  leagueSnapshot,
  player,
  purchase,
  serieATeam,
} from '../db/schema'

/**
 * Cristallizzazione, documento 1 §7 e documento 2 §4.11.
 *
 * Lo snapshot è l'unica cosa che questa applicazione produce e non può più
 * correggere: gli acquisti si modificano fino alla revisione, le versioni no —
 * invariante 14, «gli snapshot non si cancellano e non si sovrascrivono mai».
 * Quindi qui dentro non c'è nessun `update` su `league_snapshot`, e non è una
 * dimenticanza.
 */

type Reader = Pick<Db, 'select'>

/* --------------------------------------------------------------- lettura */

/**
 * Il contenuto del §7, letto dal database.
 *
 * **Niente id numerici, solo UUID**, che il §7 motiva così: «un id locale in un
 * file di scambio sembra funzionare finché non si importa su una macchina dove
 * quel numero è già occupato». Vale anche per i giocatori, dove la chiave è
 * `identity_key` e non `player.id` — e per questo il file resta leggibile da chi
 * apre lo snapshot senza avere il listone, perché il nome viaggia accanto.
 */
function buildContent(on: Reader, leagueId: number): SnapshotContent {
  const row = on
    .select({
      uuid: league.uuid,
      name: league.name,
      seasonId: league.seasonId,
      mode: league.mode,
      auctionFormat: league.auctionFormat,
      budget: league.budget,
      minBid: league.minBid,
      defenseModifier: league.defenseModifier,
    })
    .from(league)
    .where(eq(league.id, leagueId))
    .get()
  if (!row) raise('LEAGUE_MISSING')

  const slots: Record<ClassicRole, number> = { P: 0, D: 0, C: 0, A: 0 }
  for (const slot of on.select().from(leagueSlot).where(eq(leagueSlot.leagueId, leagueId)).all()) {
    slots[slot.roleCode as ClassicRole] = slot.slots
  }

  const teams = on
    .select({
      uuid: fantaTeam.uuid,
      name: fantaTeam.name,
      manager: fantaTeam.manager,
      orderIndex: fantaTeam.orderIndex,
    })
    .from(fantaTeam)
    .where(eq(fantaTeam.leagueId, leagueId))
    .orderBy(asc(fantaTeam.orderIndex))
    .all()

  const purchases = on
    .select({
      uuid: purchase.uuid,
      teamUuid: fantaTeam.uuid,
      playerIdentityKey: player.identityKey,
      playerName: player.name,
      playerTeam: serieATeam.name,
      price: purchase.price,
      slotRole: purchase.slotRole,
    })
    .from(purchase)
    .innerJoin(fantaTeam, eq(purchase.fantaTeamId, fantaTeam.id))
    .innerJoin(player, eq(purchase.playerId, player.id))
    /*
      Sinistro e non interno.

      `player.serie_a_team_id` è NOT NULL, quindi «giocatore senza club» non è
      un caso che questo database possa produrre — ma la chiave esterna la fa
      rispettare `PRAGMA foreign_keys`, che SQLite tiene spento e che questa app
      imposta a ogni apertura *per la sua connessione*. Un file toccato da
      qualcos'altro può avere un riferimento rotto, e con un join interno
      l'acquisto **sparirebbe** dallo snapshot: un resoconto a cui manca una
      riga, e che nessuno potrà più correggere perché gli snapshot non si
      riscrivono. Provato: con la chiave esterna spenta e un club inesistente,
      l'acquisto resta e `playerTeam` è null.
    */
    .leftJoin(serieATeam, eq(player.serieATeamId, serieATeam.id))
    .where(eq(purchase.leagueId, leagueId))
    .orderBy(asc(purchase.sequence))
    .all()

  return {
    league: { ...row, defenseModifier: row.defenseModifier === 1, slots },
    teams,
    purchases: purchases.map((p) => ({ ...p, slotRole: p.slotRole as ClassicRole })),
  }
}

/**
 * L'impronta: `sha256:` più il digest esadecimale della forma canonica.
 *
 * Qui e non in `shared`, dove sta la serializzazione: la regola 3 del
 * `CLAUDE.md` dice che `shared` non dipende da Node, e `createHash` è Node. La
 * divisione lascia dalla parte testabile tutto ciò che può rompersi in silenzio
 * — l'ordine delle chiavi, l'ordine degli array, la forma dei numeri — e da
 * questa parte una riga che non ha modo di sbagliare da sola.
 *
 * `sha256:` davanti perché il §7 lo scrive così, e perché un'impronta senza il
 * nome del suo algoritmo è un numero che il giorno che l'algoritmo cambia non si
 * può più leggere.
 */
export function contentHash(content: SnapshotContent): string {
  return hashOf(content, (canonical) => createHash('sha256').update(canonical, 'utf8').digest('hex'))
}

export function listSnapshots(on: Reader, leagueId: number): SnapshotSummary[] {
  return on
    .select({
      uuid: leagueSnapshot.uuid,
      version: leagueSnapshot.version,
      contentHash: leagueSnapshot.contentHash,
      producedBy: leagueSnapshot.producedBy,
      producedRole: leagueSnapshot.producedRole,
      note: leagueSnapshot.note,
      createdAt: leagueSnapshot.createdAt,
    })
    .from(leagueSnapshot)
    .where(eq(leagueSnapshot.leagueId, leagueId))
    .orderBy(desc(leagueSnapshot.version))
    .all()
}

/**
 * Una versione, o l'ultima se non se ne chiede una.
 *
 * Il contenuto torna **già letto**: il renderer riceve l'oggetto del §7 e non
 * una stringa da interpretare. Il JSON viene dalla colonna che lo ha scritto, e
 * `JSON.parse` di ciò che `JSON.stringify` ha messo lì è l'unica cosa che questa
 * riga presume.
 */
export function readSnapshot(
  on: Reader,
  leagueId: number,
  version?: number,
): SnapshotDetail | null {
  const row = on
    .select()
    .from(leagueSnapshot)
    .where(
      version === undefined
        ? eq(leagueSnapshot.leagueId, leagueId)
        : and(eq(leagueSnapshot.leagueId, leagueId), eq(leagueSnapshot.version, version)),
    )
    .orderBy(desc(leagueSnapshot.version))
    .get()
  if (!row) return null

  return {
    uuid: row.uuid,
    version: row.version,
    contentHash: row.contentHash,
    producedBy: row.producedBy,
    producedRole: row.producedRole,
    note: row.note,
    createdAt: row.createdAt,
    file: JSON.parse(row.content) as SnapshotFile,
  }
}

/* -------------------------------------------------------------- scrittura */

/**
 * «Cristallizzare produce lo snapshot, porta la lega in `closed` e apre il
 * resoconto», §4.10.
 *
 * Le anomalie non fermano niente, ed è deliberato: «Se ci sono anomalie il
 * bottone chiede conferma elencandole, ma non le impone. Chi gioca sa se una
 * rosa da 24 è un errore o un accordo tra amici.» La conferma sta
 * nell'interfaccia; qui non c'è nessun controllo di merito da rifare.
 */
export function crystallise(
  input: Input<'snapshot.create'>,
  db: Db,
  actorUuid: string,
): SnapshotDetail {
  return db.transaction((tx) => {
    const row = tx
      .select({ status: league.status, instanceRole: league.instanceRole })
      .from(league)
      .where(eq(league.id, input.leagueId))
      .get()
    if (!row) raise('LEAGUE_MISSING')
    if (frozen(row.status)) raise('LEAGUE_FROZEN')
    if (!canTransition(row.status, 'closed')) raise('NOT_IN_REVIEW')

    const content = buildContent(tx, input.leagueId)

    /**
     * Invariante 14: `version = MAX(version) + 1`.
     *
     * Dal massimo e non da un conteggio, che dopo una riapertura darebbe un
     * numero già usato — e `UNIQUE (league_id, version)` lo rifiuterebbe da
     * dentro la transazione, cioè come `UNKNOWN`. Lo stesso ragionamento della
     * sequenza degli acquisti, per lo stesso motivo.
     */
    const version =
      (tx
        .select({ n: sql<number | null>`max(${leagueSnapshot.version})` })
        .from(leagueSnapshot)
        .where(eq(leagueSnapshot.leagueId, input.leagueId))
        .get()?.n ?? 0) + 1

    const instance = tx.select().from(appInstance).where(eq(appInstance.id, 1)).get()
    const uuid = randomUUID()
    const createdAt = Date.now()
    const hash = contentHash(content)

    const file: SnapshotFile = {
      format: SNAPSHOT_FORMAT,
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      producedBy: {
        instanceUuid: instance?.uuid ?? actorUuid,
        label: instance?.label ?? null,
        role: row.instanceRole,
      },
      snapshot: { uuid, version, createdAt, contentHash: hash },
      ...content,
    }

    tx.insert(leagueSnapshot)
      .values({
        uuid,
        leagueId: input.leagueId,
        version,
        // Il file intero, non il solo contenuto: è esattamente ciò che T18
        // esporterà, e riscriverlo al momento dell'export vorrebbe dire
        // ricostruirlo da un database che nel frattempo può essere stato
        // riaperto e cambiato. Uno snapshot deve poter dire cosa c'era allora.
        content: JSON.stringify(file),
        contentHash: hash,
        producedBy: file.producedBy.label ?? file.producedBy.instanceUuid,
        producedRole: row.instanceRole,
        note: input.note ?? null,
        createdAt,
      })
      .run()

    tx.update(league)
      .set({ status: 'closed', updatedAt: createdAt })
      .where(eq(league.id, input.leagueId))
      .run()

    log(
      tx,
      input.leagueId,
      'review',
      'snapshot.create',
      { version, contentHash: hash, purchases: content.purchases.length },
      actorUuid,
    )

    return {
      uuid,
      version,
      contentHash: hash,
      producedBy: file.producedBy.label ?? file.producedBy.instanceUuid,
      producedRole: row.instanceRole,
      note: input.note ?? null,
      createdAt,
      file,
    }
  })
}

/**
 * «Riapri per modifiche», §4.11: riporta in revisione.
 *
 * L'invariante 13 la chiama «l'unica transizione» consentita a lega
 * cristallizzata, e chiede che sia **registrata nel log**. Le versioni restano
 * dove sono: la prossima cristallizzazione ne aggiunge una, e il §4.11 avvisa
 * che sarà «la versione successiva» proprio perché la precedente non sparisce.
 */
export function reopen(input: Input<'snapshot.reopen'>, db: Db, actorUuid: string): void {
  db.transaction((tx) => {
    const row = tx
      .select({ status: league.status })
      .from(league)
      .where(eq(league.id, input.leagueId))
      .get()
    if (!row) raise('LEAGUE_MISSING')
    if (row.status !== 'closed') raise('NOT_CRYSTALLISED')

    tx.update(league)
      .set({ status: 'review', updatedAt: Date.now() })
      .where(eq(league.id, input.leagueId))
      .run()

    const last = tx
      .select({ version: leagueSnapshot.version })
      .from(leagueSnapshot)
      .where(eq(leagueSnapshot.leagueId, input.leagueId))
      .orderBy(desc(leagueSnapshot.version))
      .get()

    log(tx, input.leagueId, 'review', 'league.reopen', { from: last?.version ?? null }, actorUuid)
  })
}
