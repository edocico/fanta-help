/**
 * Le due forme che una versione cristallizzata prende a schermo.
 *
 * Qui e non dentro il resoconto perché i lettori sono due — la barra del §4.11 e
 * l'anteprima di un import — e il §4.11 dice *perché* contano: il confronto fra
 * versioni non entra nella v1, e «l'elenco con data e impronta basta a capire
 * quale sia l'ultima». Se le due schermate le scrivessero in due modi diversi,
 * quel confronto a occhio smetterebbe di funzionare proprio dove serve.
 */

/**
 * «5 settembre, 23:41», la barra del §4.11 alla lettera.
 *
 * Due formattatori e non uno: chiedendo a `Intl` giorno, mese e ora insieme, in
 * italiano esce «2 settembre alle ore 22:06». La virgola la mettiamo noi.
 */
const day = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' })
const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

export function when(at: number): string {
  const d = new Date(at)
  return `${day.format(d)}, ${time.format(d)}`
}

/** `sha256:a91f4c2…` → `a91f4c2`, che è quanto ne scrive la barra del §4.11. */
export function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, '').slice(0, 7)
}
