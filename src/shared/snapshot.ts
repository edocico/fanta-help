import { z } from 'zod'
import { CLASSIC_ROLES, type ClassicRole } from './domain'

/**
 * Lo snapshot del documento 1 §7, e la sua forma canonica.
 *
 * Qui vive **solo** la serializzazione, non l'impronta. La regola 3 del
 * `CLAUDE.md` dice che `shared` non dipende né da Node né dal DOM, e sha256 non
 * esiste senza uno dei due: `node:crypto` sta nel main, `crypto.subtle` nel
 * renderer ed è pure asincrono. Quindi la divisione è questa — questo file
 * produce la stringa, il servizio del main ci calcola sopra `sha256:` — e non è
 * una perdita: tutto ciò che può rompersi in silenzio sta da questa parte, dove
 * i test arrivano. Un hash è una funzione totale della stringa che gli dài.
 *
 * L'invariante 15: «`content_hash` si calcola su una serializzazione canonica:
 * chiavi ordinate, acquisti ordinati per `uuid`, numeri senza zeri decimali
 * superflui. Due snapshot con lo stesso contenuto devono produrre lo stesso hash
 * su macchine diverse.»
 */

/**
 * Le forme del file, come schemi e non come tipi scritti a mano.
 *
 * `contracts.ts` le importa da qui invece di riscriverle: sono la stessa cosa
 * che attraversa l'IPC e che finisce su disco, e la regola 3 del `CLAUDE.md`
 * vuole una definizione sola. La direzione è questa e non l'opposta perché il
 * formato del file esiste anche senza un'interfaccia — `formatVersion` lo
 * versiona per conto suo — mentre il canale che lo trasporta no.
 *
 * Gli slot sono riscritti qui e non presi da `contracts.ts`: importarli da lì
 * farebbe un ciclo, e soprattutto sono due cose diverse che oggi hanno la stessa
 * forma. Quelli del contratto descrivono una lega viva e cambiano quando cambia
 * l'app; questi descrivono un file già pubblicato, e cambiarli senza alzare
 * `formatVersion` renderebbe illeggibile ciò che è stato scritto ieri.
 */
const count = z.number().int().min(0)
const snapshotSlots = z.object({ P: count, D: count, C: count, A: count })

export const snapshotLeague = z.object({
  uuid: z.string(),
  name: z.string(),
  seasonId: z.string(),
  mode: z.enum(['classic', 'mantra']),
  auctionFormat: z.enum(['call', 'draft']),
  budget: z.number().int(),
  minBid: z.number().int(),
  defenseModifier: z.boolean(),
  slots: snapshotSlots,
})

export const snapshotTeam = z.object({
  uuid: z.string(),
  name: z.string(),
  manager: z.string().nullable(),
  orderIndex: z.number().int(),
})

/**
 * Il nome del giocatore è denormalizzato apposta, §7: «il file deve restare
 * leggibile da chi lo apre senza avere il listone, e reggere se il listone nel
 * frattempo è cambiato».
 */
export const snapshotPurchase = z.object({
  uuid: z.string(),
  teamUuid: z.string(),
  playerIdentityKey: z.string(),
  playerName: z.string(),
  playerTeam: z.string().nullable(),
  price: z.number().int(),
  slotRole: z.enum(CLASSIC_ROLES),
})

/**
 * Le tre parti che l'impronta copre, e nient'altro.
 *
 * §7: «`contentHash` copre solo `league`, `teams` e `purchases`, non i metadati
 * di produzione. Così due istanze che hanno registrato la stessa asta producono
 * lo stesso hash anche se firmato da persone diverse.» Il tipo lo rende vero per
 * costruzione: chi calcola l'impronta non ha in mano i metadati e non può
 * infilarceli per sbaglio.
 */
export const snapshotContent = z.object({
  league: snapshotLeague,
  teams: z.array(snapshotTeam),
  purchases: z.array(snapshotPurchase),
})

export const snapshotFile = snapshotContent.extend({
  format: z.literal('fanta-help/league-snapshot'),
  formatVersion: z.number().int().positive(),
  producedBy: z.object({
    instanceUuid: z.string(),
    label: z.string().nullable(),
    role: z.enum(['admin', 'participant']),
  }),
  snapshot: z.object({
    uuid: z.string(),
    version: z.number().int().positive(),
    createdAt: z.number().int(),
    contentHash: z.string(),
  }),
})

export type SnapshotLeague = z.infer<typeof snapshotLeague>
export type SnapshotTeam = z.infer<typeof snapshotTeam>
export type SnapshotPurchase = z.infer<typeof snapshotPurchase>
export type SnapshotContent = z.infer<typeof snapshotContent>
export type SnapshotFile = z.infer<typeof snapshotFile>

export const SNAPSHOT_FORMAT = 'fanta-help/league-snapshot'

/**
 * `formatVersion` **1**, e si alza solo per un cambiamento che invalida i file
 * già pubblicati.
 *
 * La stessa regola del dataset, che il `CLAUDE.md` scrive per esteso: un campo
 * aggiunto è additivo e il lettore lo tratta come opzionale. Alzare il numero
 * per un'aggiunta renderebbe illeggibile ciò che è già stato prodotto, e non
 * alzarlo per una rimozione lascerebbe file che si dichiarano di una versione
 * che non descrivono più.
 */
export const SNAPSHOT_FORMAT_VERSION = 1

type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json }

/**
 * JSON deterministico: chiavi in ordine, nessuno spazio, niente `undefined`.
 *
 * Non `JSON.stringify` e basta. `stringify` conserva l'ordine di inserimento
 * delle chiavi, quindi lo stesso contenuto costruito da due funzioni diverse —
 * o dalla stessa funzione dopo un refactoring che sposta due righe — produce due
 * stringhe diverse e due impronte diverse. È esattamente il difetto che il
 * documento 6 §4 descrive come «si rompe in silenzio e te ne accorgi fra un
 * anno».
 *
 * I numeri passano da `JSON.stringify`, che in JavaScript è già la
 * rappresentazione più corta che rilegge allo stesso valore: `47.0` esce `47`,
 * cioè i «numeri senza zeri decimali superflui» dell'invariante 15. Quello che
 * `stringify` fa e qui non va bene è tacere: `NaN` e `Infinity` diventerebbero
 * `null`, e un prezzo diventato NaN da qualche parte a monte entrerebbe
 * nell'impronta come «nessun prezzo», identico a un prezzo mancante davvero.
 */
export function canonicalJson(value: Json): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`snapshot: numero non rappresentabile (${String(value)})`)
    }
    // Niente normalizzazione dello zero negativo: `JSON.stringify(-0)` è già
    // `0`. La versione con il ramo `value === 0 ? 0 : value` è passata dal giro
    // delle mutazioni senza che un test se ne accorgesse, perché non c'era
    // nessun numero che la potesse raggiungere.
    return JSON.stringify(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const object = value as { readonly [k: string]: Json }
  const parts = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
  return `{${parts.join(',')}}`
}

/**
 * La forma canonica del contenuto di uno snapshot.
 *
 * Oltre alle chiavi, **due array vengono riordinati**. Gli acquisti per `uuid`,
 * come dice l'invariante 15: l'ordine in cui sono stati registrati è l'ordine di
 * una serata, e due persone che hanno registrato la stessa asta lo hanno
 * diverso. E le squadre per `uuid`, che l'invariante non nomina perché dà per
 * scontato ciò che vale per gli acquisti: senza, la stessa lega letta con un
 * `ORDER BY` diverso darebbe due impronte, e lo scopo dichiarato del §7 — «due
 * istanze che hanno registrato la stessa asta producono lo stesso hash» —
 * cadrebbe sul primo confronto. L'ordine vero delle squadre non si perde: sta
 * dentro ogni squadra, in `orderIndex`.
 *
 * Riordinare copie, non gli array che arrivano: `sort` muta, e il chiamante ci
 * scrive dentro il file che poi pubblica.
 */
export function canonicalize(content: SnapshotContent): string {
  const byUuid = <T extends { uuid: string }>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0))

  return canonicalJson({
    league: content.league as unknown as Json,
    teams: byUuid(content.teams) as unknown as Json,
    purchases: byUuid(content.purchases) as unknown as Json,
  })
}

/**
 * L'impronta, meno l'unica riga che `shared` non può scrivere.
 *
 * `digest` arriva da fuori perché sha256 vuole Node o il DOM e la regola 3 non
 * li ammette qui. Ma il *legame* fra impronta e forma canonica sì, e senza
 * questa funzione quel legame viveva in una riga sola del main che nessun test
 * attraversava: sostituendo `canonicalize` con `JSON.stringify` la suite restava
 * tutta verde e l'invariante 15 si rompeva in silenzio — cioè esattamente il
 * modo di fallire che il documento 6 §4 attribuisce a questo file.
 *
 * Con la cucitura, un test passa `(s) => s` come digest e legge cosa è stato
 * dato in pasto all'algoritmo.
 */
export function hashOf(content: SnapshotContent, digest: (canonical: string) => string): string {
  return `sha256:${digest(canonicalize(content))}`
}

/* ------------------------------------------------------------- resoconto */

/**
 * Quanto ha speso una squadra, per ruolo e in tutto.
 *
 * `left` sono i crediti rimasti in mano: `budget − spent`. Può essere negativo,
 * perché la revisione lo permette — l'invariante 11 declassa il tetto a avviso —
 * e uno snapshot registra quello che è successo, non quello che sarebbe dovuto
 * succedere.
 */
export type TeamReport = {
  uuid: string
  name: string
  /** Chi la gioca. Il resoconto la nomina accanto al nome della squadra. */
  manager: string | null
  orderIndex: number
  players: number
  spent: number
  left: number
  byRole: Readonly<Record<ClassicRole, { spent: number; players: number }>>
}

/**
 * «Sotto: rose finali complete di prezzi, spesa per reparto per squadra, e i
 * numeri che alla fine si guardano sempre. Giocatore più pagato, chi ha speso di
 * più per l'attacco, chi ha chiuso con più crediti in mano.» Documento 2 §4.11.
 */
export type SnapshotReport = {
  teams: readonly TeamReport[]
  topPurchase: SnapshotPurchase | null
  topAttack: TeamReport | null
  richest: TeamReport | null
}

const ROLES: readonly ClassicRole[] = ['P', 'D', 'C', 'A']

/**
 * I numeri del resoconto, da uno snapshot e da niente altro.
 *
 * Puro, quindi si esercita sotto Vitest: il resoconto è la schermata che nessuno
 * guarderà mai due volte con gli stessi occhi — la si legge la sera della
 * chiusura, e un totale sbagliato lì dentro non ha nessun altro modo di venire
 * fuori.
 *
 * I pareggi si sciolgono in modo deterministico e non «il primo che capita»:
 * due squadre con gli stessi crediti in mano, o due acquisti allo stesso prezzo,
 * esistono davvero — anzi, a fine asta i crediti rimasti sono quasi sempre zero
 * per tutti. Senza una regola, la stessa lega letta due volte nominerebbe due
 * vincitori diversi. Fra le squadre la regola è l'ordine della lega, fra gli
 * acquisti l'`uuid`, che è l'unica cosa stabile che un acquisto abbia.
 */
export function snapshotReport(content: SnapshotContent): SnapshotReport {
  const byUuid = new Map<string, TeamReport>()
  for (const team of content.teams) {
    byUuid.set(team.uuid, {
      uuid: team.uuid,
      name: team.name,
      manager: team.manager,
      orderIndex: team.orderIndex,
      players: 0,
      spent: 0,
      left: content.league.budget,
      byRole: Object.fromEntries(ROLES.map((r) => [r, { spent: 0, players: 0 }])) as TeamReport['byRole'],
    })
  }

  for (const bought of content.purchases) {
    const team = byUuid.get(bought.teamUuid)
    // Un acquisto che nomina una squadra che non c'è non esiste: la chiave
    // esterna lo impedisce nel database, e uno snapshot letto da un file di
    // domani potrebbe non avere quella garanzia. Si scarta invece di sommarlo
    // a nessuno, che è come `undefined` entrerebbe in un totale.
    if (!team) continue
    team.players += 1
    team.spent += bought.price
    team.left -= bought.price
    const role = team.byRole[bought.slotRole]
    role.spent += bought.price
    role.players += 1
  }

  const teams = [...byUuid.values()].sort((a, b) => a.orderIndex - b.orderIndex)

  /** A parità, il più vecchio: l'ordine di registrazione è l'ordine dell'asta. */
  const topPurchase =
    [...content.purchases].sort(
      (a, b) => b.price - a.price || (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0),
    )[0] ?? null

  /**
   * A parità, quella che viene prima nell'ordine della lega — e senza doverlo
   * dire: `teams` è già in quell'ordine, e `sort` in JavaScript è stabile per
   * specifica, quindi due squadre pari restano come stavano. Lo spareggio
   * esplicito `|| a.orderIndex - b.orderIndex` c'era, ed è passato dal giro
   * delle mutazioni senza che un test se ne accorgesse: era una riga che non
   * poteva cambiare nessun risultato.
   */
  const best = (pick: (t: TeamReport) => number): TeamReport | null =>
    [...teams].sort((a, b) => pick(b) - pick(a))[0] ?? null

  const topAttack = best((t) => t.byRole.A.spent)
  return {
    teams,
    topPurchase,
    // Nessuno ha comprato un attaccante: la domanda non ha una risposta, e
    // «Real Fanta, 0 crediti» ne sarebbe una finta.
    topAttack: topAttack && topAttack.byRole.A.spent > 0 ? topAttack : null,
    richest: best((t) => t.left),
  }
}
