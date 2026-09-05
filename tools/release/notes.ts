#!/usr/bin/env node
/**
 * Le note di una Release, dai soggetti dei commit.
 *
 * Prima usavamo `gh release create --generate-notes`, e il testo lo scriveva
 * GitHub con le sue parole: «**Full Changelog**: …», in inglese. Quel corpo non
 * resta su GitHub — `electron-updater` lo legge dal feed e il nostro servizio lo
 * mette nello stato `available`, quindi finiva **dentro l'interfaccia italiana
 * dell'app**, sotto la riga «La versione 0.1.1 è disponibile.». Visto a schermo
 * provando l'aggiornamento, non dedotto.
 *
 * È la stessa forma dell'errore inglese di `electron-updater` corretto in T20:
 * un testo scritto da un servizio esterno che attraversa il confine e arriva
 * all'utente senza passare da noi. Qui però a chiederlo era una nostra riga di
 * workflow, quindi si chiude togliendola.
 *
 * I soggetti dei commit di questa repo sono già note di rilascio: raccontano
 * cosa è cambiato e perché, in italiano. Non c'è niente da scrivere in più.
 *
 * Uso:
 *   npm run release:note              da <tag precedente> a HEAD
 *   npm run release:note -- v0.1.0    da un tag esplicito
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * I soggetti dell'intervallo, dal più recente al più vecchio.
 *
 * Solo il soggetto e non il corpo: i corpi qui sono lunghi e spiegano il
 * *perché* a chi lavora sul codice, mentre queste righe le legge chi sta per
 * aggiornare. Il soggetto è già la sintesi.
 */
export function soggetti(intervallo: string): string[] {
  return execFileSync('git', ['log', '--format=%s', '--no-merges', intervallo], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
    .split('\n')
    .filter((r) => r.trim() !== '')
}

/**
 * Il tag prima di questo, o null alla prima Release.
 *
 * `HEAD^` e non `HEAD`: cercando da HEAD si troverebbe il tag che stiamo
 * pubblicando adesso, e l'intervallo sarebbe vuoto — note vuote a ogni giro,
 * senza che niente fallisca.
 */
export function tagPrecedente(): string | null {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Il corpo della Release.
 *
 * Un elenco puntato, e in fondo il confronto su GitHub per chi vuole i diff.
 * Quando non c'è niente da elencare la frase lo dice invece di lasciare il
 * vuoto: una Release senza note è indistinguibile da una Release le cui note
 * non sono arrivate.
 */
export function corpo(righe: readonly string[], versione: string, da: string | null): string {
  const testa =
    righe.length === 0
      ? 'Nessun cambiamento registrato fra le due versioni.'
      : righe.map((r) => `- ${r}`).join('\n')

  // Niente link quando i due capi coincidono. In CI non capita — il checkout
  // sta sul tag, quindi `package.json` porta già la versione nuova — ma
  // eseguendolo in locale *prima* del salto il lato «a» è ancora quello vecchio,
  // e ne usciva `compare/v0.1.1...v0.1.1`: un link a un confronto vuoto, dentro
  // un'anteprima che serve a decidere se pubblicare. L'ha preso il pre-volo.
  const degenere = da === `v${versione}`
  const confronto =
    da === null || degenere
      ? ''
      : `\n\nConfronto completo: https://github.com/edocico/fanta-help/compare/${da}...v${versione}`

  return testa + confronto
}

function main(): void {
  const esplicito = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const da = esplicito ?? tagPrecedente()
  const versione = JSON.parse(
    execFileSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8' }),
  ).version as string

  const righe = soggetti(da === null ? 'HEAD' : `${da}..HEAD`)
  process.stdout.write(corpo(righe, versione, da) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
