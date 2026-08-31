# CLAUDE.md

App desktop di supporto all'asta del fantacalcio di Serie A. Uso privato, un gruppo di amici. Serve a preparare l'asta e a registrarla dal vivo. Non gestisce il campionato.

Le specifiche complete stanno in `docs/`, un file per documento. Leggi solo quello indicato dal task, non tutti.

| # | File | Contenuto |
|---|---|---|
| 1 | `01-scope-e-modello-dati.md` | Scope, dominio, schema SQLite, invarianti, snapshot |
| 2 | `02-flussi-e-schermate.md` | Direzione visiva, viste, flusso d'asta, scorciatoie |
| 3 | `03-architettura.md` | Struttura repo, IPC, livello dati, sicurezza, build |
| 4 | `04-pipeline-dati.md` | Fonti, pipeline offline, riconciliazione, import |
| 5 | `05-roadmap-claude-code.md` | Roadmap dei task |
| 6 | `06-testing.md` | Suite di test con Vitest, si innesta da T4 |
| 0 | `00-revisione.md` | Registro della revisione, chiusa |

---

## Stack

Electron + electron-vite + React + TypeScript · better-sqlite3 + Drizzle nel main · Tailwind v4 + shadcn/ui · Zustand + TanStack Query nel renderer · electron-builder.

Sono decisioni prese, non proposte. Se una sembra sbagliata, dillo prima di cambiarla.

---

## Le tre regole

1. **Il database vive solo nel main.** Il renderer non importa Drizzle, non conosce SQLite, non sa che esiste un file `.db`. Parla solo con l'API tipizzata via IPC.
2. **Le invarianti stanno nei servizi del main, non nell'interfaccia.** L'interfaccia disabilita il bottone per cortesia; il servizio rivalida sempre. Un componente con un bug non deve poter corrompere i dati.
3. **Ogni tipo è definito una volta sola in `src/shared`.** `shared` non importa mai da `main` o `renderer`, e non dipende né da Node né dal DOM.

---

## Non fare

- **Non togliere `UNIQUE (league_id, order_index)` da `fanta_team`.** Se il riordino fallisce, il problema è il riordino: va fatto in transazione passando per indici temporanei negativi. Il vincolo serve.
- **Non aggiungere una chiave esterna a `player_season_stat.season_id`.** Le statistiche coprono stagioni che non hanno una riga in `season`, di proposito.
- **Non usare `localStorage` o `sessionStorage`.** Stato effimero in Zustand, stato persistente nel main.
- **Non scrivere scraper.** Le fonti si scaricano a mano e lo script legge file locali. Unica eccezione: API-Football per gli infortuni, a runtime e in cache.
- **Non fare corrispondenze di nomi a runtime.** L'identità tra fonti si risolve offline e viaggia in `player_external_id`.
- **Non aggiungere dipendenze** senza dirlo. In particolare: niente axios, il main ha `fetch` nativo.

---

## Trappole note

Sono già costate tempo. Non riscoprirle.

| Trappola | Cosa fare |
|---|---|
| `PRAGMA foreign_keys` | SQLite lo tiene spento. Impostarlo **a ogni apertura**, altrimenti metà dei vincoli non esiste |
| Migrazioni Drizzle in produzione | Percorso relativo → finisce in `app.asar` e fallisce su `meta/_journal.json`. Usare percorso assoluto e spedire `drizzle/` in `extraResources` |
| better-sqlite3 | Modulo nativo. `asarUnpack` deve includere anche `bindings` e `file-uri-to-path`, o l'app parte in dev e crolla in produzione |
| Cross-build fra piattaforme | `package:win` e `package:linux` ricompilano `better-sqlite3` per il target e ce lo lasciano. Dopo, `npm run dev` muore con `NODE_MODULE_VERSION mismatch`: rimettere a posto con `electron-builder install-app-deps` |
| electron-vite | `externalizeDepsPlugin()` in `main` e `preload`, o la build fallisce in modo illeggibile |
| `"type": "module"` in `package.json` | Non rimetterlo. Fa emettere a electron-vite un main ESM, e `import { BrowserWindow } from 'electron'` esplode all'istanziazione: `electron` è CJS con getter pigri. Muore con **codice 0 e stderr vuoto** dal pacchetto |
| Percorso dei dati utente | `app.getPath('userData')` deriva da `app.getName()`, che legge `package.json`. `productName` nell'`electron-builder.yml` a runtime non esiste: senza `productName` anche in `package.json`, sviluppo e app installata scrivono nello stesso database |
| React Router su `file://` | `HashRouter`, mai `BrowserRouter` |
| `F11` | È già lo schermo intero di sistema. Il modo proiezione usa `Ctrl/Cmd+P` |

---

## Convenzioni

**Lingua.** Codice, identificatori, commenti e nomi di file in **inglese**. Testi rivolti all'utente in **italiano**. I messaggi d'errore stanno in `src/shared/errors.ts` accanto al codice, mai sparsi nei componenti.

**Errori.** Mai eccezioni attraverso il confine IPC. Sempre l'involucro `Result<T>` con un codice.

**Scrittura.** Ogni scrittura che tocca più tabelle sta in una transazione.

**Copy dell'interfaccia.** Un errore dice cosa è successo e cosa fare, non si scusa. Uno stato vuoto è un invito ad agire. Etichette in minuscolo, mai maiuscolo spaziato.

---

## Test

Poco e mirato. Non serve copertura, servono questi:

- Le invarianti dei servizi d'asta, in particolare la puntata massima e la regola di completabilità.
- La serializzazione canonica dello snapshot: lo stesso contenuto con le chiavi in ordine diverso deve produrre lo stesso hash. Se si rompe, si rompe in silenzio.
- La copertura dei canali IPC: la lista dei contratti e quella degli handler registrati devono coincidere.

Niente test sull'interfaccia in v1.

---

## Come lavoriamo

Un task per sessione. Alla fine di ogni fase, **produci un pacchetto installabile e provalo**, non aspettare la fine del progetto.

Per leggere cosa mostra davvero l'app pacchettizzata, lanciala con `--remote-debugging-port=9222` e interroga il DOM via protocollo DevTools: Node ha un client WebSocket integrato, non serve installare niente.

**Prima di chiudere una fase, sempre una review.** Che compili e giri non basta: rileggi il lavoro contro le regole di questo file e contro il documento del task, e di' cosa non torna invece di chiudere in silenzio. Ogni rilievo va verificato contro il codice prima di riportarlo: in T1 sette su dieci erano plausibili e falsi.

Se una specifica è ambigua o sbagliata, fermati e chiedi. Non indovinare e non "sistemare" silenziosamente una scelta che sembra strana: quasi tutte le stranezze in questi documenti sono deliberate e motivate.
