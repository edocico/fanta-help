import { readFile, writeFile } from 'node:fs/promises'
import { and, eq, inArray } from 'drizzle-orm'
import type { Input, Output } from '@shared/contracts'
import type { ClassicRole } from '@shared/domain'
import { appError, DomainError, raise } from '@shared/errors'
import { snapshotFile, SNAPSHOT_FORMAT_VERSION, type SnapshotFile } from '@shared/snapshot'
import type { CellValue } from '@shared/sheet'
import { workbookSheets } from '@shared/workbook'
import type { Db } from '../db/client'
import { log } from './log'
import { readSnapshot } from './snapshot'
import { fantaTeam, league, leagueSlot, leagueSnapshot, player, purchase, season } from '../db/schema'

/**
 * Export e import di una sessione, documento 2 §4.11 e documento 1 §2.
 *
 * Niente `electron` e niente `exceljs`: i dialoghi e la scrittura della cartella
 * di lavoro arrivano dal contesto. È lo stesso vincolo che tiene `handlers.ts`
 * caricabile sotto Node per il test di copertura dei canali, un passo più in là.
 */

export type SnapshotIoContext = {
  db: Db
  /** Chi sta importando: `auction_log.actor_uuid` è l'uuid dell'istanza. */
  instanceUuid: string
  backup: () => Promise<string>
  /** Dove salvare. Null se il dialogo è stato annullato. */
  chooseSaveTo: (name: string) => Promise<string | null>
  /** Il file da importare. Null se annullato. */
  chooseSnapshot: () => Promise<string | null>
  /** L'altra metà del lettore XLSX: apre la cartella e la scrive. */
  writeGrid: (file: string, sheets: { name: string; rows: CellValue[][] }[]) => Promise<void>
}

/**
 * Il nome proposto nel dialogo di salvataggio.
 *
 * Porta lega, versione ed estensione perché di questi file se ne accumulano —
 * uno per versione e per formato — e in una cartella dei download «resoconto
 * (3).json» non dice più di quale lega sia. Gli spazi e i caratteri che i
 * filesystem non amano diventano trattini, e non è pignoleria: su Windows un
 * nome con `:` non si salva e il dialogo lo respinge senza spiegarsi.
 */
export function fileNameFor(leagueName: string, version: number, extension: string): string {
  const slug =
    leagueName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'lega'
  return `${slug}-v${version}.${extension}`
}

function requireSnapshot(ctx: SnapshotIoContext, leagueId: number, version?: number) {
  const found = readSnapshot(ctx.db, leagueId, version)
  if (!found) raise('SNAPSHOT_MISSING')
  return found
}

export async function exportJson(
  input: Input<'snapshot.exportJson'>,
  ctx: SnapshotIoContext,
): Promise<Output<'snapshot.exportJson'>> {
  const found = requireSnapshot(ctx, input.leagueId, input.version)
  const path = await ctx.chooseSaveTo(fileNameFor(found.file.league.name, found.version, 'json'))
  if (path === null) return null

  /**
   * Il file come è stato scritto allora, riletto e reindentato — non ricostruito
   * dal database di adesso.
   *
   * `readSnapshot` legge la colonna `content`, che è la copia congelata. Se la
   * lega nel frattempo è stata riaperta e cambiata, questo file continua a dire
   * quello che diceva, e la sua impronta continua a tornare. È l'unica cosa che
   * rende confrontabili due export fatti da due macchine.
   */
  await writeFile(path, `${JSON.stringify(found.file, null, 2)}\n`, 'utf8')
  return { path }
}

export async function exportXlsx(
  input: Input<'snapshot.exportXlsx'>,
  ctx: SnapshotIoContext,
): Promise<Output<'snapshot.exportXlsx'>> {
  const found = requireSnapshot(ctx, input.leagueId, input.version)
  const path = await ctx.chooseSaveTo(fileNameFor(found.file.league.name, found.version, 'xlsx'))
  if (path === null) return null

  await ctx.writeGrid(path, workbookSheets(found.file))
  return { path }
}

/* ---------------------------------------------------------------- import */

/** Quanti nomi si scrivono per esteso prima di contarli e basta. */
const NAMES_SHOWN = 5

/** L'elenco troncato, in un posto solo: due tronchi diversi sono due liste. */
function names(all: readonly string[]): string {
  return all.slice(0, NAMES_SHOWN).join(', ') + (all.length > NAMES_SHOWN ? '…' : '')
}

async function readSnapshotFile(filePath: string): Promise<SnapshotFile> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    raise('SNAPSHOT_UNREADABLE')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    raise('SNAPSHOT_UNREADABLE')
  }

  /**
   * La versione del formato si guarda **prima** dello schema.
   *
   * Un file più nuovo fallirebbe la validazione su un campo che questa app non
   * conosce, e direbbe «non ha la forma di un resoconto» a un file che ce l'ha
   * benissimo — solo più avanti. Il documento 4 §4 fissa la regola nell'altro
   * verso: un campo aggiunto è additivo e il lettore lo tratta come opzionale,
   * quindi `formatVersion` sale solo quando qualcosa di obbligatorio cambia, ed
   * è esattamente il caso in cui non si può leggere.
   */
  const declared = (parsed as { formatVersion?: unknown })?.formatVersion
  if (typeof declared === 'number' && declared > SNAPSHOT_FORMAT_VERSION) {
    raise('SNAPSHOT_FORMAT_TOO_NEW', { found: declared, known: SNAPSHOT_FORMAT_VERSION })
  }

  const check = snapshotFile.safeParse(parsed)
  if (!check.success) raise('SNAPSHOT_INVALID')
  return check.data
}

/**
 * I vincoli che lo schema zod non sa esprimere e le tabelle sì.
 *
 * La convenzione «Errori» del `CLAUDE.md` in una riga: «se una tabella ha un
 * `UNIQUE`, lo schema che la alimenta deve averlo». `fanta_team` è unica su
 * `(league_id, name)` e su `(league_id, order_index)`, `purchase` su
 * `(league_id, player_id)`: un file che li viola passa la validazione, arriva
 * fino a dentro la transazione, e torna al renderer come `UNKNOWN` — «Qualcosa
 * non ha funzionato» — dopo che l'anteprima aveva detto di sì.
 *
 * Non è un caso di scuola per il fatto che l'app non produce file simili: un
 * import esiste per leggere file che non ha scritto lui.
 */
function incoherent(file: SnapshotFile): ReturnType<typeof appError> | null {
  const names = new Set<string>()
  const orders = new Set<number>()
  const uuids = new Set<string>()
  for (const team of file.teams) {
    if (names.has(team.name) || orders.has(team.orderIndex) || uuids.has(team.uuid)) {
      return appError('SNAPSHOT_DUPLICATE_TEAM', { name: team.name })
    }
    names.add(team.name)
    orders.add(team.orderIndex)
    uuids.add(team.uuid)
  }

  const bought = new Set<string>()
  for (const purchased of file.purchases) {
    if (!uuids.has(purchased.teamUuid)) return appError('SNAPSHOT_UNKNOWN_TEAM')
    if (bought.has(purchased.playerIdentityKey)) {
      return appError('SNAPSHOT_DUPLICATE_PLAYER', { name: purchased.playerName })
    }
    bought.add(purchased.playerIdentityKey)
  }

  return null
}

/**
 * Cosa l'import troverebbe, senza scrivere niente.
 *
 * Le due domande che decidono tutto — il listone c'è? i giocatori ci sono? — si
 * fanno qui e nell'import con la stessa funzione, così la schermata non può
 * promettere un import che poi fallisce.
 */
function inspect(
  file: SnapshotFile,
  db: Pick<Db, 'select'>,
): { ids: Map<string, number>; missing: string[]; refusal: ReturnType<typeof appError> | null } {
  const ids = new Map<string, number>()
  const missing: string[] = []

  const broken = incoherent(file)
  if (broken) return { ids, missing, refusal: broken }

  const installed = db.select().from(season).where(eq(season.id, file.league.seasonId)).get()
  if (!installed) {
    return {
      ids,
      missing,
      refusal: appError('SNAPSHOT_SEASON_MISSING', { seasonId: file.league.seasonId }),
    }
  }

  /**
   * Dentro la stagione della lega, e non per sola chiave d'identità.
   *
   * `identity_key` è `fc-<sourceId>`, cioè **la stessa chiave per lo stesso
   * giocatore in ogni stagione** — è tutto il punto della riconciliazione del
   * documento 4 §5 — e più listoni convivono nello stesso database. Senza il
   * filtro, la ricerca torna una riga per stagione e la mappa tiene l'ultima:
   * l'acquisto finirebbe agganciato al giocatore di un altro anno, con l'altro
   * club e magari l'altro ruolo. Cadrebbero l'invariante 7 e la 6 insieme, in
   * silenzio, e ricristallizzando uscirebbe un'impronta diversa da quella del
   * file — cioè il contrario di ciò per cui l'export esiste.
   *
   * Non si vedeva provandolo: il database di sviluppo ha una stagione sola, e
   * con una sola la query sbagliata dà la risposta giusta.
   */
  const keys = [...new Set(file.purchases.map((p) => p.playerIdentityKey))]
  const roles = new Map<string, string>()
  if (keys.length > 0) {
    for (const row of db
      .select({ id: player.id, key: player.identityKey, role: player.roleClassic })
      .from(player)
      .where(and(inArray(player.identityKey, keys), eq(player.seasonId, file.league.seasonId)))
      .all()) {
      ids.set(row.key, row.id)
      roles.set(row.key, row.role)
    }
  }

  const changedRole: string[] = []
  for (const bought of file.purchases) {
    if (!ids.has(bought.playerIdentityKey)) {
      missing.push(bought.playerName)
      continue
    }
    // Invariante 6: `slot_role` deve coincidere col ruolo del giocatore, e qui
    // il ruolo arriva dal file mentre il giocatore è quello locale. Se il
    // listone nel frattempo ha cambiato ruolo a qualcuno, le due cose non
    // possono stare insieme: tenere il file romperebbe l'invariante, tenere il
    // listone darebbe una lega che non corrisponde più all'impronta del file.
    if (roles.get(bought.playerIdentityKey) !== bought.slotRole) {
      changedRole.push(`${bought.playerName} (${bought.slotRole} → ${roles.get(bought.playerIdentityKey)})`)
    }
  }

  if (missing.length === 0 && changedRole.length > 0) {
    return {
      ids,
      missing,
      refusal: appError('SNAPSHOT_ROLE_CHANGED', {
        n: changedRole.length,
        seasonId: file.league.seasonId,
        names: names(changedRole),
      }),
    }
  }

  return {
    ids,
    missing,
    refusal:
      missing.length === 0
        ? null
        : appError('SNAPSHOT_PLAYERS_MISSING', {
            n: missing.length,
            seasonId: file.league.seasonId,
            names: names(missing),
          }),
  }
}

/** La lega locale che questo file sostituirebbe, se c'è. */
function existing(db: Pick<Db, 'select'>, uuid: string) {
  const row = db
    .select({ id: league.id, name: league.name })
    .from(league)
    .where(eq(league.uuid, uuid))
    .get()
  if (!row) return null

  const purchases = db.select().from(purchase).where(eq(purchase.leagueId, row.id)).all().length
  const versions = db
    .select()
    .from(leagueSnapshot)
    .where(eq(leagueSnapshot.leagueId, row.id))
    .all().length
  return { id: row.id, name: row.name, purchases, versions }
}

export async function previewSnapshot(
  input: Input<'snapshot.preview'>,
  ctx: SnapshotIoContext,
): Promise<Output<'snapshot.preview'>> {
  const file = await readSnapshotFile(input.filePath)
  const { missing, refusal } = inspect(file, ctx.db)
  const replaced = existing(ctx.db, file.league.uuid)

  return {
    file: input.filePath,
    leagueName: file.league.name,
    seasonId: file.league.seasonId,
    version: file.snapshot.version,
    contentHash: file.snapshot.contentHash,
    createdAt: file.snapshot.createdAt,
    producedBy: file.producedBy.label,
    teams: file.teams.length,
    purchases: file.purchases.length,
    missing: missing.slice(0, NAMES_SHOWN),
    missingTotal: missing.length,
    replaces: replaced && {
      name: replaced.name,
      purchases: replaced.purchases,
      versions: replaced.versions,
    },
    refusal,
  }
}

/**
 * La sessione entra, intera.
 *
 * La lega atterra **cristallizzata**, con la riga di `league_snapshot` scritta
 * dal file: versione, data e impronta originali. Le due macchine restano
 * d'accordo su cosa sia «la versione 3», che è tutto il motivo per cui
 * l'impronta esiste — e riprendere il lavoro è la riapertura del §4.11, che
 * esiste già. Una lega importata in `review` avrebbe perso proprio quel numero.
 *
 * Il backup viene prima, ed è quello con la rotazione a dieci che usa l'import
 * del listone: sostituire una lega cancella acquisti e versioni locali, e
 * l'unica rete sotto è quella.
 */
export async function importSnapshot(
  input: Input<'snapshot.import'>,
  ctx: SnapshotIoContext,
): Promise<Output<'snapshot.import'>> {
  const file = await readSnapshotFile(input.filePath)
  const { ids, refusal } = inspect(file, ctx.db)
  if (refusal) throw new DomainError(refusal)

  const backup = await ctx.backup()

  return ctx.db.transaction((tx) => {
    const replaced = existing(tx, file.league.uuid)
    // La cascata porta via squadre, acquisti, obiettivi, piani e snapshot.
    if (replaced) tx.delete(league).where(eq(league.id, replaced.id)).run()

    const now = Date.now()
    const leagueId = tx
      .insert(league)
      .values({
        uuid: file.league.uuid,
        name: file.league.name,
        seasonId: file.league.seasonId,
        mode: file.league.mode,
        auctionFormat: file.league.auctionFormat,
        budget: file.league.budget,
        minBid: file.league.minBid,
        defenseModifier: file.league.defenseModifier ? 1 : 0,
        /**
         * `admin` e non il ruolo del file. `producedBy.role` dice chi ha
         * prodotto *quello snapshot*, che è un fatto di quel file; il ruolo
         * della lega dice cosa può fare questa installazione, ed è un fatto di
         * questa macchina. Importare una sessione prodotta da un partecipante
         * non degrada chi la importa.
         */
        instanceRole: 'admin',
        status: 'closed',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: league.id })
      .get().id

    for (const role of ['P', 'D', 'C', 'A'] as ClassicRole[]) {
      tx.insert(leagueSlot).values({ leagueId, roleCode: role, slots: file.league.slots[role] }).run()
    }

    const teamIds = new Map<string, number>()
    for (const team of file.teams) {
      const id = tx
        .insert(fantaTeam)
        .values({
          uuid: team.uuid,
          leagueId,
          name: team.name,
          manager: team.manager,
          isMine: 0,
          orderIndex: team.orderIndex,
        })
        .returning({ id: fantaTeam.id })
        .get().id
      teamIds.set(team.uuid, id)
    }

    let sequence = 0
    for (const bought of file.purchases) {
      const teamId = teamIds.get(bought.teamUuid)
      const playerId = ids.get(bought.playerIdentityKey)
      // Nessuno dei due può mancare: `inspect` ha già rifiutato per i giocatori,
      // e una squadra che il file nomina senza elencarla renderebbe il file
      // incoerente con sé stesso.
      if (teamId === undefined || playerId === undefined) raise('SNAPSHOT_INVALID')
      sequence += 1
      tx.insert(purchase)
        .values({
          uuid: bought.uuid,
          leagueId,
          fantaTeamId: teamId,
          playerId,
          price: bought.price,
          slotRole: bought.slotRole,
          sequence,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    tx.insert(leagueSnapshot)
      .values({
        // L'uuid dello snapshot viaggia col file, come quelli delle squadre e
        // degli acquisti: è l'identità che le due macchine condividono, ed è
        // ciò che rende «la versione 3» la stessa cosa di qua e di là.
        // `league_snapshot.uuid` è UNIQUE su tutto il database e non collide,
        // perché la lega omonima viene cancellata in questa stessa transazione.
        uuid: file.snapshot.uuid,
        leagueId,
        version: file.snapshot.version,
        content: JSON.stringify(file),
        contentHash: file.snapshot.contentHash,
        producedBy: file.producedBy.label ?? file.producedBy.instanceUuid,
        producedRole: file.producedBy.role,
        note: null,
        createdAt: file.snapshot.createdAt,
      })
      .run()

    log(
      tx,
      leagueId,
      'review',
      'snapshot.import',
      {
        version: file.snapshot.version,
        contentHash: file.snapshot.contentHash,
        purchases: file.purchases.length,
        replaced: replaced !== null,
      },
      // L'istanza che sta importando, non un uuid fabbricato qui: su un progetto
      // che esiste per spostare sessioni fra due macchine, «quale macchina ha
      // importato questa sessione» è la domanda che il registro deve saper
      // ripetere, e un uuid nuovo a ogni import non corrisponde a nessuna riga
      // di `app_instance`.
      ctx.instanceUuid,
    )

    return {
      leagueId,
      leagueName: file.league.name,
      version: file.snapshot.version,
      teams: file.teams.length,
      purchases: file.purchases.length,
      replaced: replaced !== null,
      backup,
    }
  })
}
