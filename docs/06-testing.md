# Fanta-Help — Documento 6: Suite di test

> Documento aggiuntivo, scritto dopo l'inizio dell'implementazione. Si innesta nella roadmap del documento 5 a partire dal task T4.
>
> **Nel task T1 non c'è niente da cambiare.** Se lo spike di packaging è in corso, portalo a termine così com'è.

---

## 1. La scelta

**Vitest.** Usa la stessa pipeline di trasformazione di Vite, quindi TypeScript funziona senza una configurazione separata, e l'API è quella di Jest. Gira su Node, che è esattamente dove servono i nostri test: in v1 non testiamo l'interfaccia.

Nessuna dipendenza oltre a `vitest`. Niente jsdom, niente Testing Library, niente strumenti di copertura: non servono e allungherebbero solo l'installazione.

---

## 2. La trappola da conoscere prima di iniziare

`better-sqlite3` è un modulo nativo, e viene **ricompilato per l'ABI di Electron** da `electron-builder install-app-deps`. Vitest gira su **Node normale**, che ha un ABI diverso. Importare il database in un test dà `NODE_MODULE_VERSION mismatch`.

Le vie d'uscita ovvie sono tutte cattive:

- **Ricompilare avanti e indietro** tra i test e lo sviluppo: lento, e prima o poi qualcuno dimentica un passaggio e perde un'ora a capire perché.
- **Far girare i test dentro Electron**: strumenti in più per un beneficio piccolo, e il ciclo di test smette di essere veloce.
- **Sostituire il database con un finto**: i test verificherebbero il finto, non la logica.

La via buona non aggira il problema, cambia dove sta la logica.

---

## 3. Le invarianti come funzioni pure

Le invarianti che contano davvero — puntata massima, completabilità, slot pieni, crediti residui — sono aritmetica su un oggetto piccolo. **Non hanno bisogno di un database.** Hanno bisogno di sapere quanti crediti restano e quanti slot sono liberi.

Se stanno in `src/shared/domain.ts`, i test girano su Node senza mai toccare SQLite. E c'è un vantaggio che viene gratis: il documento 3 stabilisce già che `shared` non può dipendere da Node né dal DOM. Quella regola, presa per la type safety, ci consegna un nucleo testabile per costruzione.

```ts
// src/shared/domain.ts — nessuna dipendenza da Node, dal DOM o dal database

export const MATCHDAYS = 38

export type Role = 'P' | 'D' | 'C' | 'A'

export type RosterState = {
  credits: number                    // crediti residui
  filled:  Record<Role, number>      // slot occupati per ruolo
  slots:   Record<Role, number>      // slot totali per ruolo
}

export function freeSlots(r: RosterState): number {
  return (Object.keys(r.slots) as Role[])
    .reduce((n, role) => n + (r.slots[role] - r.filled[role]), 0)
}

// invariante 5, con la guardia
export function maxBid(r: RosterState, minBid: number): number {
  const free = freeSlots(r)
  if (free <= 0) return 0          // senza questa riga tornerebbe credits + minBid
  return r.credits - (free - 1) * minBid
}

export type Violation = {
  code: ErrorCode
  blocking: boolean                // in `review` le violazioni di merito non bloccano
  detail: Record<string, unknown>
}

export function checkPurchase(
  r: RosterState,
  role: Role,
  price: number,
  minBid: number,
  severity: 'blocking' | 'advisory',
): Violation[] { /* … */ }
```

Il servizio nel main si riduce a tre righe, con l'input/output fuori e la logica dentro:

```ts
// src/main/services/auction.ts
export const assign = db.transaction((input: AssignInput) => {
  const roster     = readRosterState(db, input.fantaTeamId)          // I/O
  const violations = checkPurchase(roster, role, input.price,
                                   league.minBid, 'blocking')        // puro
  if (violations.some(v => v.blocking)) throw new InvariantError(violations)

  const purchase = insertPurchase(...)                               // I/O
  // …
})
```

**Il guardrail che tiene in piedi tutto questo:** se un file di test ha bisogno di importare `better-sqlite3`, `electron` o qualcosa da `src/main/db/`, non è il test a essere sbagliato. È la logica che sta nel posto sbagliato e va spostata in `shared/domain.ts`.

---

## 4. Cosa si testa

Tre file. In v1 non serve altro.

### `src/shared/domain/invariants.test.ts`

I casi che rovinano una serata se sbagliati. Scritti a tabella, non uno per funzione.

| Caso | Atteso |
|---|---|
| Rosa con 1 slot libero, 40 crediti, min 1 | `maxBid` = 40 |
| Rosa con 5 slot liberi, 40 crediti, min 1 | `maxBid` = 36 |
| **Rosa completa, 40 crediti** | `maxBid` = **0**, non 41 |
| 20 crediti, 15 slot liberi, prezzo 19 | violazione di completabilità |
| 20 crediti, 15 slot liberi, prezzo 5 | nessuna violazione |
| Ruolo con slot già pieni | violazione `ROLE_SLOTS_FULL` |
| Prezzo sotto la puntata minima | violazione `BELOW_MIN_BID` |
| Le stesse violazioni con severità `advisory` | presenti ma con `blocking: false` |

L'ultima riga è quella che protegge l'invariante 11: in revisione le violazioni di merito si segnalano e non bloccano, e deve essere la stessa funzione con un parametro diverso, non una seconda implementazione che col tempo diverge.

### `src/shared/snapshot/canonical.test.ts`

La serializzazione canonica, che se si rompe si rompe in silenzio e te ne accorgi fra un anno.

- Stesso contenuto con le chiavi in ordine diverso → **stesso hash**.
- Stessi acquisti in ordine diverso nell'array → **stesso hash**.
- Un prezzo cambiato di un credito → **hash diverso**.
- Metadati di produzione diversi, contenuto identico → **stesso hash** (il `contentHash` copre solo `league`, `teams`, `purchases`).

### `src/main/ipc/coverage.test.ts`

La lista dei canali in `contracts.ts` e quella degli handler registrati devono coincidere, in entrambe le direzioni.

Perché funzioni, `ipc/handlers.ts` deve esporre la mappa canale → funzione **senza importare `electron`**. Il collegamento a `ipcMain` sta in `register.ts`, che il test non tocca. È il motivo per cui i due file sono separati.

---

## 5. E il database?

In v1 **non si testa**, ed è una scelta, non una dimenticanza.

È coperto da altro:

- **I vincoli dello schema stesso.** Indici unici, chiavi esterne e `CHECK` falliscono rumorosamente. Un giocatore comprato due volte nella stessa lega non passa, e non serve un test per verificarlo.
- **Una verifica manuale su un caso solo**, quello che si rompe in silenzio: un reimport del listone non deve toccare gli acquisti già registrati. È già il criterio di completamento del task T7.

Se in futuro servissero test d'integrazione veri sul livello dati, la strada pulita è uno script separato eseguito sotto Electron, non Vitest. Va tenuto fuori dal ciclo veloce dei test, che deve restare istantaneo per essere usato.

---

## 6. Configurazione

Serve un file a parte: `electron.vite.config.ts` esporta la struttura a tre target `main`/`preload`/`renderer`, che Vitest non sa interpretare.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
})
```

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

`tools/**` è incluso per i test della pipeline dati. La normalizzazione dei nomi, che questo documento immaginava lì, sta invece in `src/shared/domain.ts`: il documento 4 §5 la vuole condivisa con la ricerca dell'app, e due implementazioni divergerebbero in silenzio. I suoi quattro casi — `Vlahović` → `vlahovic`, `N'Dicka` → `ndicka` — vivono quindi in `src/shared/domain.test.ts`, e proteggono tutta la riconciliazione a valle.

---

## 7. Dove si innesta nella roadmap

| Task | Cosa aggiungere |
|---|---|
| **T1** | niente. Se è in corso, finiscilo com'è |
| **T4** | installare Vitest, creare `vitest.config.ts`, scrivere `coverage.test.ts`. Separare `handlers.ts` da `register.ts` |
| **T5** | test della normalizzazione dei nomi |
| **T13** | scrivere `invariants.test.ts` **prima** dei servizi d'asta: le funzioni pure sono la specifica |
| **T17** | `canonical.test.ts` insieme alla serializzazione |

Su T13 vale la pena insistere. Le funzioni pure di `shared/domain.ts` e i loro test vengono prima del servizio che le usa, perché sono la definizione di cosa è corretto. Scrivere il servizio prima significa scoprire le regole mentre si scrive il codice che le applica, che è il modo più affidabile di scrivere regole sbagliate.

---

## 8. Cosa cambia negli altri documenti

Se hai già copiato i documenti in `docs/`, questi sono i punti da allineare. Sono tutti piccoli.

| Documento | Modifica |
|---|---|
| 3 §2 | `vitest.config.ts` nella radice; `ipc/handlers.ts` separato da `ipc/register.ts`; `shared/domain.ts` ospita le invarianti come funzioni pure |
| 3 §9 | la sezione Qualità è sostituita da questo documento |
| 5, T4 · T5 · T13 · T17 | ambito dei test come nella tabella sopra |
| `CLAUDE.md` | Vitest nello stack, la trappola dell'ABI nella tabella, il guardrail della sezione 3 |

Nient'altro cambia. Lo schema, le invarianti, i contratti IPC e la pipeline restano come sono: questo documento sposta **dove vive** la logica delle invarianti, non cosa dicono.
