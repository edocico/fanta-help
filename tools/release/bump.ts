#!/usr/bin/env node
/**
 * Quanto salta la versione, letto dai commit.
 *
 * La regola sta qui e in nessun altro posto: la usa la skill `/rilascia` in
 * locale e la usa il workflow di GitHub. Due copie divergerebbero, e
 * divergerebbero in silenzio — il tipo di difetto che questa repo raccoglie in
 * una tabella.
 *
 * Un commit dichiara il proprio peso con un **trailer**, non con un prefisso nel
 * soggetto:
 *
 *     T21: le impostazioni, e la chiave API che non si vede mai
 *
 *     [...il corpo narrativo di sempre...]
 *
 *     Release: minor
 *     Co-Authored-By: ...
 *
 * Il trailer e non `feat:`/`fix:` perché il soggetto qui è prosa che spiega il
 * *perché* — misurato: 3 commit su 84 rispettano Conventional Commits, e il
 * `CLAUDE.md` tratta quello stile come deliberato. I trailer invece sono già di
 * casa: `Co-Authored-By:` compare 27 volte.
 *
 * Vince il più alto dell'intervallo. Un commit senza trailer pesa `patch`: è il
 * pavimento, non un default nascosto — se nell'intervallo non c'è niente di più
 * grosso, il salto *è* una patch.
 *
 * In Node e non in shell perché gira su tre runner e su due macchine tue, e
 * `sed`/`grep` cambiano dialetto fra GNU e BSD: una riga che estrae un numero
 * torna vuota su BSD e lo strumento si lamenta di altro. È una trappola già
 * pagata in `muta.sh`.
 *
 * Uso:
 *   npm run release:bump --               salto da <ultimo tag>..HEAD
 *   npm run release:bump -- v0.1.0..HEAD  su un intervallo esplicito
 *   npm run release:bump -- --spiega      e dice anche perché
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** L'ordine è il punto: si confrontano per indice, non per nome. */
export const PESI = ['patch', 'minor', 'major'] as const

export type Salto = (typeof PESI)[number]

/**
 * Il trailer, per come git lo intende: riga propria, in fondo, `Chiave: valore`.
 *
 * `^` e `$` con la `m` perché il corpo è multiriga. Il valore è insensibile alle
 * maiuscole — chi scrive «Release: Minor» intende quello, e rifiutarglielo in
 * silenzio farebbe uscire una patch dove voleva una minor.
 */
const TRAILER = /^Release:[ \t]*(patch|minor|major)[ \t]*$/gim

/**
 * Il salto dichiarato da un singolo messaggio di commit, o null.
 *
 * Se un commit ne porta più d'uno vince il più alto, che è l'unica lettura che
 * non perde informazione.
 */
export function saltoDelCommit(messaggio: string): Salto | null {
  const trovati = [...messaggio.matchAll(TRAILER)].map((m) => m[1].toLowerCase() as Salto)
  if (trovati.length === 0) return null
  return trovati.reduce((a, b) => (PESI.indexOf(b) > PESI.indexOf(a) ? b : a))
}

/**
 * Il salto di un insieme di messaggi.
 *
 * Un intervallo vuoto non ha nessun salto: torna null invece di `patch`, perché
 * «non c'è niente da rilasciare» e «c'è una correzione» sono due risposte
 * diverse e chi chiama deve poterle distinguere. Confonderle farebbe pubblicare
 * una versione identica alla precedente.
 */
export function saltoDelloIntervallo(messaggi: readonly string[]): Salto | null {
  if (messaggi.length === 0) return null
  let salto: Salto = 'patch'
  for (const m of messaggi) {
    const s = saltoDelCommit(m)
    if (s !== null && PESI.indexOf(s) > PESI.indexOf(salto)) salto = s
  }
  return salto
}

/** Il tag più recente raggiungibile, o null se non ce n'è nessuno. */
export function ultimoTag(): string | null {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * I messaggi dei commit dell'intervallo, interi.
 *
 * Separati da NUL e non da a capo: il corpo di questi commit *contiene* righe
 * vuote e righe che cominciano per maiuscola, quindi qualunque separatore
 * testuale finirebbe per spezzare un messaggio a metà e perdere il trailer, che
 * sta in fondo.
 */
export function messaggi(intervallo: string): string[] {
  const grezzo = execFileSync('git', ['log', '--format=%B%x00', intervallo], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return grezzo.split('\0').filter((m) => m.trim() !== '')
}

function main(): void {
  const argomenti = process.argv.slice(2)
  const spiega = argomenti.includes('--spiega')
  const intervallo = argomenti.find((a) => !a.startsWith('--'))

  const tag = ultimoTag()
  const range = intervallo ?? (tag === null ? 'HEAD' : `${tag}..HEAD`)

  const corpi = messaggi(range)
  const salto = saltoDelloIntervallo(corpi)

  if (salto === null) {
    if (spiega) process.stderr.write(`Nessun commit in ${range}: niente da rilasciare.\n`)
    process.exit(1)
  }

  if (spiega) {
    const soggetti = execFileSync(
      'git',
      ['log', '--format=%h%x01%s%x01%(trailers:key=Release,valueonly)', range],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
    process.stderr.write(`da ${tag ?? 'sempre'}: ${corpi.length} commit\n\n`)
    for (const riga of soggetti) {
      const [sha = '', soggetto = '', dichiarato = ''] = riga.split('\x01')
      const peso = dichiarato.trim() === '' ? '·' : dichiarato.trim()
      process.stderr.write(`  ${peso.padEnd(6)} ${sha}  ${soggetto}\n`)
    }
    process.stderr.write(`\nsalto: ${salto}\n`)
  }

  process.stdout.write(`${salto}\n`)
}

// Eseguito direttamente, non importato da un test. Il confronto è fra URL
// risolti e non `endsWith('bump.mjs')`, che combacia dentro `prova-bump.ts`:
// con quello, importare il modulo da un test faceva girare `main()` e stampare
// un salto che nessuno aveva chiesto. Stessa forma della trappola del token che
// è prefisso di un altro, dal lato del suffisso — e l'ha presa il test, al
// primo giro.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
