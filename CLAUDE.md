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

Electron + electron-vite + React + TypeScript · better-sqlite3 + Drizzle nel main · Tailwind v4 + shadcn/ui · Zustand + TanStack Query nel renderer · Vitest · electron-builder.

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
| `PRAGMA foreign_keys` | SQLite lo tiene spento. Impostarlo **a ogni apertura**, altrimenti metà dei vincoli non esiste. È per-connessione: interrogare il `.db` dall'esterno non dice se l'app l'ha impostato, può rispondere solo l'app |
| `enum` di Drizzle | Tipizza in TypeScript ed emette **zero** SQL. Senza un `check()` accanto il vincolo esiste solo nel compilatore, e il database accetta qualunque cosa |
| `player_fts` contentless | `content=''` indicizza senza conservare i valori: un `MATCH` torna il rowid e colonne **vuote**. Non è rotta — si risale a `player` per rowid |
| Migrazioni già applicate | Il migratore confronta solo il timestamp dell'**ultima** riga di `__drizzle_migrations`, e l'hash lo scrive senza mai rileggerlo. Modificare un `.sql` già applicato è un no-op silenzioso: funziona su un database nuovo e non su nessuno esistente. Ogni statement in più va in un file numerato nuovo |
| Migrazioni Drizzle in produzione | Percorso relativo → finisce in `app.asar` e fallisce su `meta/_journal.json`. Usare percorso assoluto e spedire `drizzle/` in `extraResources` |
| better-sqlite3 | Modulo nativo. `asarUnpack` deve includere anche `bindings` e `file-uri-to-path`, o l'app parte in dev e crolla in produzione |
| Verificare il modulo nativo | `require('better-sqlite3')` riesce **anche con l'ABI sbagliata**: `bindings` carica il `.node` solo al primo `new Database()`. Per provarlo, istanzia — e usa l'ABI di Electron: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -e "new (require('better-sqlite3'))(':memory:')"` |
| Cross-build fra piattaforme | `package:win` e `package:linux` ricompilano `better-sqlite3` per il target e ce lo lasciano. Dopo, `npm run dev` muore con `NODE_MODULE_VERSION mismatch`: rimettere a posto con `electron-builder install-app-deps` |
| Vitest e il modulo nativo | Vitest gira su Node, `better-sqlite3` è compilato per l'ABI di Electron: un test che lo importa muore con `NODE_MODULE_VERSION mismatch`. Non ricompilare avanti e indietro — è il segnale che la logica sta nel posto sbagliato (vedi Test) |
| electron-vite | `externalizeDepsPlugin()` in `main` e `preload`, o la build fallisce in modo illeggibile |
| `"type": "module"` in `package.json` | Non rimetterlo. Fa emettere a electron-vite un main ESM, e `import { BrowserWindow } from 'electron'` esplode all'istanziazione: `electron` è CJS con getter pigri. Muore con **codice 0 e stderr vuoto** dal pacchetto. Vitest lo consiglia a ogni esecuzione: ignoralo |
| Percorso dei dati utente | `app.getPath('userData')` deriva da `app.getName()`, che legge `package.json`. `productName` nell'`electron-builder.yml` a runtime non esiste: senza `productName` anche in `package.json`, sviluppo e app installata scrivono nello stesso database |
| `ELECTRON_RUN_AS_NODE` | VS Code lo esporta a `1` nei suoi terminali, su entrambe le macchine. Electron esegue il main come Node normale: `require('electron').app` è `undefined` e l'app muore con `Cannot read properties of undefined (reading 'isPackaged')`. Lanciarla con `env -u ELECTRON_RUN_AS_NODE` |
| `@theme inline` di Tailwind | Elimina le variabili che nessuna utility usa. Una mappatura sbagliata **non compare** nel CSS costruito e sembra assente: si sveglia al primo componente che la tocca |
| Raggi in Tailwind v4 | Vivono sotto `--radius-*`. Un `--radius` nudo non alimenta nessuna utility e viene scartato, e ogni `rounded-md` torna al default di 6px |
| CLI di shadcn | Senza `paths` nel `tsconfig.json` di radice non fallisce: crea una cartella chiamata letteralmente `@` |
| React Router su `file://` | `HashRouter`, mai `BrowserRouter` |
| `F11` | È già lo schermo intero di sistema. Il modo proiezione usa `Ctrl/Cmd+P` |

---

## Convenzioni

**Lingua.** Codice, identificatori, commenti e nomi di file in **inglese**. Testi rivolti all'utente in **italiano**. I messaggi d'errore stanno in `src/shared/errors.ts` accanto al codice, mai sparsi nei componenti.

**Errori.** Mai eccezioni attraverso il confine IPC. Sempre l'involucro `Result<T>` con un codice. Un servizio che rifiuta chiama `raise('CODICE', {…})` da `shared/errors.ts`: un `throw new Error` qualsiasi arriva al renderer come `UNKNOWN`, e il messaggio giusto sparisce senza che niente fallisca.

**Scrittura.** Ogni scrittura che tocca più tabelle sta in una transazione.

**Copy dell'interfaccia.** Un errore dice cosa è successo e cosa fare, non si scusa. Uno stato vuoto è un invito ad agire. Intestazioni di colonna e valori in minuscolo, titoli di vista e di sezione in sentence case, acronimi con le maiuscole. Mai maiuscolo spaziato.

---

## Test

Poco e mirato. Non serve copertura, servono questi:

- Le invarianti dei servizi d'asta, in particolare la puntata massima e la regola di completabilità.
- La serializzazione canonica dello snapshot: lo stesso contenuto con le chiavi in ordine diverso deve produrre lo stesso hash. Se si rompe, si rompe in silenzio.
- La copertura dei canali IPC: la lista dei contratti e quella degli handler registrati devono coincidere.

Niente test sull'interfaccia in v1.

**Il guardrail.** I test girano su Node, quindi non possono toccare il database. Se un test ha bisogno di importare `better-sqlite3`, `electron` o qualcosa da `src/main/db/`, non è il test a essere sbagliato: è la logica che sta nel posto sbagliato e va spostata in `src/shared/domain.ts` come funzione pura. Le invarianti che contano sono aritmetica su crediti e slot: non hanno bisogno di SQLite.

---

## Due macchine

Il progetto si sviluppa su **Fedora x64** e su **macOS arm64**, sempre dalla stessa persona e mai in parallelo. Quello che ne segue:

- **Niente piattaforma cablata negli strumenti.** L'architettura si ricava da `uname -m`, il binario di Electron da `node_modules/electron/dist/path.txt`. Un percorso scritto a mano funziona su una macchina e sull'altra muore con un `No such file or directory` che sembra un'installazione rotta.
- **Il database non viaggia.** `userData` sta in posti diversi su dischi diversi: una lega preparata di qua non si trova di là. Per spostare una sessione serve l'export/import JSON di T18, non una copia di file.
- **`.claude.local.md` esiste su una macchina sola**, perché è ignorato da git. Se una cosa vale su entrambe va qui, non lì.
- **I limiti sono asimmetrici.** Su Fedora l'AppImage vuole `libfuse2` e il `.deb` vuole `libxcrypt-compat`; su macOS l'app non è firmata e al primo avvio va aperta col tasto destro. Chi documenta un limite dice su quale delle due vale.
- Il `package-lock.json` porta tutte le varianti di piattaforma, quindi cambiare macchina non lo fa oscillare. Se cambia, è per una ragione vera.

---

## Come lavoriamo

Un task per sessione. Alla fine di ogni fase, **produci un pacchetto installabile e provalo**, non aspettare la fine del progetto.

Per leggere cosa mostra davvero l'app: **`/prova-pacchetto`** (`dev` o `pack`) costruisce, lancia e stampa il DOM via DevTools. Le trappole d'avvio sono già dentro lo script: non riscoprirle.

**Strumenti del progetto:** `/apri-task <n>` apre un task leggendo solo i documenti che indica · agenti `revisore-fase` e `deriva-documenti` · gli hook in `.claude/hooks/` bloccano le violazioni delle tre regole prima che tocchino il disco.

**Prima di chiudere una fase, sempre una review**, con l'agente `revisore-fase`. Che compili e giri non basta: rileggi il lavoro contro le regole di questo file e contro il documento del task, e di' cosa non torna invece di chiudere in silenzio. Ogni rilievo va verificato contro il codice prima di riportarlo: in T1 sette su dieci erano plausibili e falsi. Verificare vuol dire **eseguire**: applicare il DDL a un database di scorta e confrontare i `pragma`, impacchettare un modulo con esbuild per vedere cosa tira dentro davvero.

Se una specifica è ambigua o sbagliata, fermati e chiedi. Non indovinare e non "sistemare" silenziosamente una scelta che sembra strana: quasi tutte le stranezze in questi documenti sono deliberate e motivate.

---

Note di questa macchina, non condivise: @.claude.local.md

