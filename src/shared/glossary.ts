/**
 * Every abbreviation the interface prints, in one place, because the interface
 * is full of them and it cannot help it: a column 40px wide cannot be headed
 * "Fantamedia", and whoever opens this app for the first time does not know
 * half of them.
 *
 * The rule that makes it workable, document 7 §10: **an abbreviation explains
 * itself where it is defined, never where it is used.** The column heading, the
 * badge, the label: yes. The six hundred cells underneath: no. A popover on
 * every cell of a long table would be the worst thing we could do to this
 * screen.
 *
 * ## The key is the string on screen
 *
 * T23 left this open — the key could have been the source's column name, with a
 * third field for the label. It is not, and the evidence is one-sided.
 *
 * `Qt`, which document 7 §10 uses as an example of a column name, **is not a
 * column name**: the four listoni were opened and their header row read, and it
 * is `Id | R | RM | Nome | Squadra | Qt.A | Qt.I | Diff. | Qt.A M | Qt.I M |
 * Diff.M | FVM | FVM M`, identical in all four years. Keying on the source would
 * have turned one entry into four. Six of the entries below have no column at
 * all — `bon`, `pt.`, `pr.`, `tit.`, `cr` and `max` are computed in `domain.ts`
 * — so their key would have had to be invented, which is where "honest towards
 * the data" stops being true. And `CS` and `min` carry the name of an FBref
 * column while the cell shows a *ratio* of two of them, so the key would have
 * named one thing and the cell shown another.
 *
 * The precedent is unanimous the same way: `ROLE_LABELS`, `TEAM_COLORS`, the
 * four `*_LABELS` of the league view all key on the **stored value** and keep
 * the user's wording in a field of its own. Document 1 §8 had already settled
 * the twin question among its closed decisions: "`matches_rated` internally,
 * `Pv` in the interface".
 *
 * ## What is deliberately not here
 *
 * Document 7 §10 also asks for the roles and the Serie A club codes. They
 * cannot be keys of this object and the reason is not tidiness:
 *
 * - **The role letters collide.** `C` and `A` belong to both vocabularies at
 *   once and mean different things. Measured on the 2026-27 dataset, Mantra `A`
 *   is carried by 33 Classic attaccanti **and by 19 Classic centrocampisti** —
 *   Zaccagni, Orsolini, Pulisic read `ruo C` and Mantra `W;A` on the same row.
 *   An object cannot hold two `A`. They keep living in `ROLE_LABELS` and
 *   `MANTRA_ROLES`, which already spell them out.
 * - **The club codes are data.** All twenty are derived at build time from the
 *   club name and change with every promotion and relegation; the installed
 *   dataset still carries FRO, MON and VEN. Written out here they would be three
 *   keys matching nothing and three clubs with no entry, and nothing would fail.
 *   The column `squa` explains the column; the values explain themselves.
 *
 * The reference panel still lists all three sets — roles and club codes read
 * from the data — because a panel can show what a type cannot promise.
 */

/** An expansion and an explanation are two different things: knowing that `FM`
 *  stands for "fantamedia" does not tell you what a fantamedia is. Document 7
 *  §10 gives the entry two fields for exactly that reason, and the popover shows
 *  both. */
export type GlossaryEntry = {
  /** The words behind the letters. A noun phrase, capitalised, no full stop. */
  readonly full: string
  /** What the number actually means. Whole sentences. */
  readonly explains: string
}

export const glossary = {
  ruo: {
    full: 'Ruolo',
    explains: 'Il ruolo Classic: portiere, difensore, centrocampista, attaccante.',
  },
  squa: {
    full: 'Squadra',
    explains: 'La squadra di Serie A, col codice di tre lettere.',
  },
  'qt.': {
    full: 'Quotazione attuale',
    explains: 'Quanto vale oggi sul listone. È il prezzo da cui parte in asta.',
  },
  FVM: {
    full: 'Fantavalore di mercato',
    explains: 'Quanto dovrebbe costare all’asta secondo Fantacalcio.it.',
  },
  FM: {
    full: 'Fantamedia',
    explains: 'La media dei voti con bonus e malus già conteggiati.',
  },
  MV: {
    full: 'Media voto',
    explains: 'La media dei voti in pagella, senza bonus né malus.',
  },
  Pv: {
    full: 'Partite a voto',
    explains: 'In quante giornate ha preso un voto in pagella. Chi non entra non fa media.',
  },
  bon: {
    full: 'Indice bonus',
    explains: 'Quanto aggiunge al voto in gol e assist. Sotto zero i malus pesano più dei bonus.',
  },
  'pt.': {
    full: 'Punteggio',
    explains: 'Quanto vale nel complesso, sulla scala di una fantamedia.',
  },
  'pr.': {
    full: 'Prezzo atteso',
    explains:
      'Quanto dovrebbe costare, dividendo i crediti della lega fra i giocatori che entrano in rosa.',
  },
  'tit.': {
    full: 'Titolarità',
    explains: 'Quante delle sue presenze sono da titolare. Il resto sono ingressi dalla panchina.',
  },
  min: {
    full: 'Minuti a partita',
    explains: 'Minuti medi quando scende in campo.',
  },
  CS: {
    full: 'Clean sheet',
    explains: 'Porte inviolate sulle partite iniziate da titolare.',
  },
  cr: {
    full: 'Crediti',
    explains: 'I crediti che restano da spendere.',
  },
  max: {
    full: 'Puntata massima',
    explains: 'Il più che può offrire tenendo un credito per ogni slot ancora libero.',
  },
  '#': {
    full: 'Numero d’ordine',
    explains: 'L’ordine in cui gli acquisti sono stati registrati.',
  },
  '★': {
    full: 'Obiettivo',
    explains: 'I giocatori che hai segnato, con la priorità da una a cinque stelle.',
  },
} as const satisfies Record<string, GlossaryEntry>

/**
 * The only abbreviations that may reach the screen.
 *
 * `Abbr` is what makes the criterion of T23 enforceable rather than hoped for:
 * `<Abbr name="Fx" />` does not compile. It is the same discipline as the IPC
 * contracts — the compiler prevents the divergence instead of trusting someone
 * to notice it.
 */
export type Abbr = keyof typeof glossary

/** In the order they are declared, which is the order the players table draws
 *  its columns in: the reference panel reads the same way the screen does. */
export const ABBREVIATIONS = Object.keys(glossary) as readonly Abbr[]
