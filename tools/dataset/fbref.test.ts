import { describe, expect, it } from 'vitest'
import { optionalInt, parseCsv, requireColumns } from './csv'
import { mergeTable, type FbrefRow } from './fbref'

/**
 * The FBref export is hand-made once a season from a page that has already
 * changed shape once. Everything tested here is a way of reading it that fails
 * *quietly*: a thousands separator read as a decimal point turns 2.701 minutes
 * into 2, a repeated header row becomes a player called "Player", and
 * Goalkeeping's `Starts` — starts in goal — overwriting the general one rewrites
 * every keeper's season. None of the three throws on its own.
 */

const STANDARD = [
  ',,,,,,,Playing Time,Playing Time,Playing Time',
  'Rk,Player,Nation,Pos,Squad,Age,Born,MP,Starts,Min',
  '1,Marcus Thuram,fr FRA,FW,Inter,27,1997,30,25,"2,101"',
  'Rk,Player,Nation,Pos,Squad,Age,Born,MP,Starts,Min',
  '2,Yann Sommer,ch SUI,GK,Inter,36,1988,38,38,"3,420"',
  '',
].join('\n')

const PLAYING_TIME = [
  'Rk,Player,Nation,Pos,Squad,Age,MP,Min,Starts',
  '1,Marcus Thuram,fr FRA,FW,Inter,27,34,"2,701",30',
].join('\n')

const GOALKEEPING = [
  'Rk,Player,Nation,Pos,Squad,Age,MP,Starts,Min,CS,Save%,Save%',
  '1,Yann Sommer,ch SUI,GK,Inter,36,38,37,"3,420",12,71.2,80.0',
].join('\n')

const read = (text: string, label: string): ReturnType<typeof parseCsv> =>
  parseCsv(text, ['Player', 'Squad'], label)

describe('il lettore CSV', () => {
  it("scavalca l'intestazione di gruppo e trova quella vera", () => {
    const table = read(STANDARD, 'standard')
    expect(table.headerRow).toBe(2)
    expect(table.headers[1]).toBe('Player')
  })

  it("salta l'intestazione ripetuta in mezzo alle righe", () => {
    const table = read(STANDARD, 'standard')
    expect(table.rows).toHaveLength(2)
    expect(table.rows.map((row) => row.player)).toEqual(['Marcus Thuram', 'Yann Sommer'])
  })

  it('legge 2.701 minuti come 2701 e non come 2', () => {
    const table = read(STANDARD, 'standard')
    expect(optionalInt(table.rows[1], 'Min')).toBe(3420)
  })

  it('nomina la colonna che non ha riconosciuto', () => {
    expect(() => requireColumns(read(PLAYING_TIME, 'pt'), ['Born'], 'pt')).toThrow(/non riconosciute: Born/)
  })

  it('rifiuta una colonna ripetuta solo se serve davvero quella', () => {
    const table = read(GOALKEEPING, 'gk')
    expect(table.duplicates).toContain('save%')
    expect(() => requireColumns(table, ['Player', 'Squad', 'CS'], 'gk')).not.toThrow()
    expect(() => requireColumns(table, ['Save%'], 'gk')).toThrow(/ripetute, quindi ambigue: Save%/)
  })

  it('elenca cosa ha letto quando non trova nessuna intestazione', () => {
    expect(() => read('a,b,c\n1,2,3', 'ignoto')).toThrow(/nessuna riga fra le prime/)
  })
})

describe('la precedenza fra le tre tabelle', () => {
  const merged = (): Map<string, FbrefRow> => {
    const into = new Map<string, FbrefRow>()
    mergeTable(into, read(STANDARD, 'standard'), 'standard', 'standard')
    mergeTable(into, read(PLAYING_TIME, 'pt'), 'playing-time', 'pt')
    mergeTable(into, read(GOALKEEPING, 'gk'), 'goalkeeping', 'gk')
    return into
  }

  it('lascia vincere Playing Time, che il documento §3 dice più completa', () => {
    const thuram = merged().get('marcus thuram|inter')
    expect(thuram).toMatchObject({ matchesPlayed: 34, starts: 30, minutes: 2701, birthYear: 1997 })
  })

  it("non lascia che le presenze da portiere di Goalkeeping riscrivano quelle generali", () => {
    const sommer = merged().get('yann sommer|inter')
    expect(sommer).toMatchObject({ starts: 38, cleanSheets: 12, minutes: 3420, birthYear: 1988 })
  })
})
