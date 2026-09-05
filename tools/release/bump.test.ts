import { describe, expect, test } from 'vitest'
import { saltoDelCommit, saltoDelloIntervallo } from './bump'

/**
 * La regola del salto di versione, fissata.
 *
 * Non è copertura per la copertura: questa funzione decide che numero porta la
 * prossima Release, e sbagliando produce un pacchetto che l'updater confronta
 * col numero sbagliato. Un test che passasse comunque non direbbe niente, quindi
 * ogni caso qui sotto è stato ucciso da almeno una mutazione — ordine dei pesi
 * invertito, `>` in `<`, il pavimento alzato a `minor`, l'intervallo vuoto che
 * torna `patch`, il trailer non ancorato alla riga: cinque su cinque uccise.
 */

/** Un commit di casa: soggetto narrativo, corpo, e i trailer in fondo. */
function corpo(trailer: string): string {
  return `Un soggetto qualsiasi\n\nUn corpo\ncon delle righe.\n\n${trailer}Co-Authored-By: x <y>\n`
}

describe('saltoDelCommit', () => {
  test('senza trailer non dichiara niente', () => {
    expect(saltoDelCommit(corpo(''))).toBeNull()
  })

  test('legge i tre valori', () => {
    expect(saltoDelCommit(corpo('Release: patch\n'))).toBe('patch')
    expect(saltoDelCommit(corpo('Release: minor\n'))).toBe('minor')
    expect(saltoDelCommit(corpo('Release: major\n'))).toBe('major')
  })

  test('le maiuscole del valore non cambiano niente', () => {
    // Chi scrive «Release: Minor» intende una minor, e rifiutarglielo in
    // silenzio farebbe uscire una patch dove ne voleva una più grossa.
    expect(saltoDelCommit(corpo('Release: Minor\n'))).toBe('minor')
    expect(saltoDelCommit(corpo('RELEASE: MAJOR\n'))).toBe('major')
  })

  test('accetta il tab come separatore, che è ciò che git ammette', () => {
    expect(saltoDelCommit(corpo('Release:\tpatch\n'))).toBe('patch')
  })

  test('con due trailer vince il più alto', () => {
    expect(saltoDelCommit(corpo('Release: patch\nRelease: major\n'))).toBe('major')
    expect(saltoDelCommit(corpo('Release: major\nRelease: patch\n'))).toBe('major')
  })

  test('un valore inventato non è un trailer', () => {
    // Meglio nessuna dichiarazione che una dichiarazione indovinata: senza
    // trailer il commit pesa `patch`, che è il pavimento e non una scelta.
    expect(saltoDelCommit(corpo('Release: enorme\n'))).toBeNull()
  })

  test('deve stare su una riga propria, non in mezzo alla prosa', () => {
    // Questi commit *parlano* delle Release: «la prima Release nasce
    // invisibile» è un soggetto vero di questa repo. Un pattern non ancorato
    // trasformerebbe una frase in una dichiarazione di versione.
    expect(saltoDelCommit('vedi Release: major nel corpo del messaggio\n')).toBeNull()
    expect(saltoDelCommit('Parliamo di Release: minor qui.\n')).toBeNull()
  })
})

describe('saltoDelloIntervallo', () => {
  test('un intervallo vuoto non è una patch', () => {
    // La distinzione che conta: «niente da rilasciare» e «c'è una correzione»
    // sono due risposte diverse, e confonderle pubblicherebbe una versione
    // identica alla precedente.
    expect(saltoDelloIntervallo([])).toBeNull()
  })

  test('commit tutti muti pesano una patch', () => {
    expect(saltoDelloIntervallo([corpo(''), corpo(''), corpo('')])).toBe('patch')
  })

  test('basta un commit ad alzare tutto l’intervallo', () => {
    expect(saltoDelloIntervallo([corpo(''), corpo('Release: minor\n'), corpo('')])).toBe('minor')
  })

  test('vince il più alto, in qualunque ordine arrivi', () => {
    // Nei due versi, perché un test scritto in un ordine solo passerebbe metà
    // delle volte contro una funzione che tiene l'ultimo invece del massimo.
    expect(saltoDelloIntervallo([corpo('Release: minor\n'), corpo('Release: major\n')])).toBe('major')
    expect(saltoDelloIntervallo([corpo('Release: major\n'), corpo('Release: minor\n')])).toBe('major')
  })
})
