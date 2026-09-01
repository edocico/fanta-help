/**
 * Modello di harness: copialo nella cartella temporanea della sessione, scrivi
 * le tue prove in fondo, e lancialo con
 *
 *   bash .claude/skills/prova-servizio/run.sh /percorso/harness.ts
 *
 * Il database è in memoria e lo schema arriva dai `.sql` di `drizzle/`: sono le
 * stesse migrazioni che gira l'app, quindi ogni `CHECK`, ogni `UNIQUE` e ogni
 * chiave esterna sono quelli veri. `foreign_keys = ON` è impostato qui perché
 * SQLite lo tiene spento e senza metà dei vincoli non esiste.
 *
 * I percorsi degli import sono assoluti di proposito: il file vive fuori dal
 * progetto e gli alias `@shared/…` di tsconfig non lo raggiungono.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import * as schema from '/home/edoardocicognani/Code/fanta-help/src/main/db/schema'

const ROOT = '/home/edoardocicognani/Code/fanta-help'

const conn = new Database(':memory:')
conn.pragma('foreign_keys = ON')
for (const file of readdirSync(`${ROOT}/drizzle`).filter((f) => f.endsWith('.sql')).sort()) {
  for (const stmt of readFileSync(`${ROOT}/drizzle/${file}`, 'utf8').split('--> statement-breakpoint')) {
    const s = stmt.trim()
    if (s) conn.exec(s)
  }
}
// `as any`: drizzle tipizza lo schema in modo strutturale e l'harness non ha il
// tsconfig del progetto. Qui non serve la type safety, serve il database vero.
const db = drizzle(conn, { schema }) as any

/* ------------------------------------------------------------ la semina */

/** L'uuid che i servizi scrivono in `auction_log.actor_uuid`. */
const ME = 'harness'

for (const [id, label] of [
  ['2026-27', 'Serie A 2026/27'],
  // Una seconda stagione serve a provare l'invariante 7: un giocatore che
  // esiste, passa la chiave esterna e appartiene a un altro listone.
  ['2025-26', 'Serie A 2025/26'],
]) {
  conn
    .prepare(
      "insert into season (id,label,dataset_version,source,has_fbref,imported_at) values (?,?,'1','xlsx',0,1)",
    )
    .run(id, label)
}
conn
  .prepare("insert into serie_a_team (id,season_id,name,code) values (1,'2026-27','Inter','INT'),(2,'2025-26','Inter','INT')")
  .run()

let nextId = 0
/** Un giocatore nel listone indicato. Torna il suo id. */
function player(season: string, team: number, name: string, role: 'P' | 'D' | 'C' | 'A'): number {
  nextId += 1
  conn
    .prepare(
      'insert into player (id,season_id,serie_a_team_id,identity_key,source_id,name,name_normalized,role_classic,penalty_taker)' +
        ' values (?,?,?,?,?,?,?,?,0)',
    )
    .run(nextId, season, team, `fc-${nextId}`, String(nextId), name, name.toLowerCase(), role)
  return nextId
}

/**
 * Esegue una prova e ne stampa l'esito senza fermarsi al primo rifiuto.
 *
 * I rifiuti sono la metà interessante: un `DomainError` porta il suo `appError`,
 * ed è lì che si vede se il messaggio è quello giusto o se il codice è arrivato
 * come UNKNOWN — che è il difetto che questo harness esiste per trovare.
 */
function prova(label: string, fn: () => unknown): void {
  try {
    const out = fn()
    console.log(`OK   ${label}${out === undefined ? '' : '  ' + String(out)}`)
  } catch (e: any) {
    console.log(`RIF  ${label} -> ${e?.appError?.code ?? e?.constructor?.name} :: ${e?.message}`)
  }
}

/* ------------------------------------------------------------- le prove */

const P = player('2026-27', 1, 'Sommer', 'P')
const D = player('2026-27', 1, 'Dimarco', 'D')
const A = player('2026-27', 1, 'Lautaro', 'A')
const ALTRA_STAGIONE = player('2025-26', 2, 'Fantasma', 'A')

void P
void D
void A
void ALTRA_STAGIONE
void ME
void db

// TODO: importa i servizi che ti servono, per esempio
//
//   import { createLeague } from '/…/src/main/services/league'
//   import { assign, startAuction } from '/…/src/main/services/auction'
//
// e scrivi le prove. Le due che valgono sempre la pena:
//
//   prova('il caso normale', () => …)              // e stampa lo stato dopo
//   prova('il rifiuto che deve scattare', () => …) // e leggi *quale* codice esce
console.log('harness pronto: scrivi le prove in fondo al file')
