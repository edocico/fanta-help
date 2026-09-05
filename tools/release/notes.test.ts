import { describe, expect, test } from 'vitest'
import { corpo } from './notes'

/**
 * Il corpo delle note di rilascio.
 *
 * Si prova `corpo` e non `soggetti`/`tagPrecedente`, che sono `git log` e
 * `git describe`: quelle due leggono la repo, e un test che le esercitasse
 * fisserebbe la storia del progetto invece del comportamento dello strumento.
 * `corpo` è la parte che decide cosa legge l'utente.
 */

describe('corpo', () => {
  test('elenca i soggetti come punti', () => {
    const c = corpo(['Il workflow di Release', 'Un README che parla di questo progetto'], '0.2.0', 'v0.1.1')
    expect(c).toContain('- Il workflow di Release')
    expect(c).toContain('- Un README che parla di questo progetto')
  })

  test('un intervallo vuoto lo dice, invece di lasciare il vuoto', () => {
    // Note vuote e note non arrivate sono indistinguibili a schermo, e la
    // schermata di aggiornamento le stampa sotto «La versione X è disponibile».
    const c = corpo([], '0.2.0', 'v0.1.1')
    expect(c).toContain('Nessun cambiamento registrato')
    expect(c).not.toContain('- ')
  })

  test('aggiunge il confronto quando c’è un tag da cui partire', () => {
    const c = corpo(['qualcosa'], '0.2.0', 'v0.1.1')
    expect(c).toContain('/compare/v0.1.1...v0.2.0')
  })

  test('alla prima Release non c’è nessun confronto da offrire', () => {
    // `tagPrecedente()` torna null quando non esiste un tag prima di questo, e
    // un link `/compare/null...` sarebbe una riga rotta dentro l'app.
    const c = corpo(['la prima cosa'], '0.1.0', null)
    expect(c).not.toContain('/compare/')
    expect(c).toBe('- la prima cosa')
  })

  test('non lascia entrare inglese', () => {
    // La ragione per cui questo file esiste: `--generate-notes` metteva
    // «Full Changelog» dentro l'interfaccia italiana dell'app.
    const c = corpo(['una riga'], '0.2.0', 'v0.1.1')
    expect(c).not.toMatch(/Full Changelog/i)
  })
})
