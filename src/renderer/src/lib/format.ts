/**
 * Come questa applicazione scrive un numero e una data.
 *
 * I numeri stavano in fondo a `PlayersView.tsx` e, identici, in fondo a
 * `PlayerDetail.tsx`: 667 byte per parte, gli stessi cinque formattatori e la
 * stessa `show()`, con i commenti da una parte sola. Non erano divergenti — sono
 * stati confrontati byte per byte prima di accorparli — ma erano due, e i
 * commenti sono la specifica: dicono perché una quotazione non ha decimali e
 * perché `bon` ne ha uno e non due. Qui ci arriva anche `Figure`, che è il terzo
 * lettore e il motivo per cui il modulo esiste.
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

/**
 * Italian numerals, spelled as the mock of document 2 §4.4 spells them: `32`,
 * `9,12`, `+2,7`.
 *
 * Quotazioni, FVM and Pv are whole things — a quotazione of `36,0` invites the
 * reader to look for the tenths that do not exist. `bon` carries its sign
 * because the column answers "how much beyond the vote", and an unsigned 2,25
 * next to an unsigned 0,93 hides that one of them could have been negative.
 */
const whole = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })
const dec1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dec2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/**
 * One decimal, not two, because that is how the mock of document 2 §4.4 writes
 * the column: 2,71 appears as `+2,7`. Deliberate rounding — `bon` is read by
 * scanning a column for who brings bonuses, not by checking that FM minus MV
 * comes out right, and the second decimal is noise in that reading.
 */
const signed = new Intl.NumberFormat('it-IT', {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const pct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 0 })

/**
 * What a figure is, named for what it means rather than for how many decimals it
 * has — `average` and `decimal` are two decimals and one, and which is which is
 * not something a call site should have to remember.
 *
 * `money` formats like `whole` and is the only one that carries a colour: amber
 * is money and nothing else, document 7 §15, "nemmeno una volta".
 */
export type FigureKind = 'whole' | 'money' | 'average' | 'decimal' | 'signed' | 'percent'

const FORMATS: Record<FigureKind, Intl.NumberFormat> = {
  whole,
  money: whole,
  average: dec2,
  decimal: dec1,
  signed,
  percent: pct,
}

/** Never zero, never "NaN": a metric that cannot be computed shows an em dash. */
export function show(value: number | null | undefined, kind: FigureKind = 'whole'): string {
  return value === null || value === undefined ? '—' : FORMATS[kind].format(value)
}
