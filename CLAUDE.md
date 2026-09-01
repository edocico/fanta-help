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
| 7 | `07-design-system.md` | Design system: token, tipografia, componenti. Si applica **dopo l'MVP**, in fase 8 |
| 0 | `00-revisione.md` | Registro della revisione, chiusa |

Il 7 è una **differenza** rispetto al 2, non un suo doppione: la sua intestazione e il suo §1 elencano cosa cambia. Dove i due dissentono su densità, tipografia, badge o board, ha ragione il 7 ed è voluto — non è un rilievo.

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
| Dove va una dipendenza | Dipende da chi la importa, e le due metà sbagliano in direzioni opposte. **Main e preload** usano `externalizeDepsPlugin()`: non vengono impacchettate, quindi si caricano a runtime da `node_modules` e devono stare in `dependencies` — electron-builder **pota le devDependencies**, quindi da lì funzionerebbero in sviluppo e morirebbero nel pacchetto (successo con `exceljs`). **Il renderer** invece viene impacchettato da Vite: le sue librerie finiscono nel bundle e in `dependencies` verrebbero spedite due volte. Per questo `react` sta fra le dev, e con lui TanStack e uFuzzy |
| better-sqlite3 | Modulo nativo. `asarUnpack` deve includere anche `bindings` e `file-uri-to-path`, o l'app parte in dev e crolla in produzione |
| Verificare il modulo nativo | `require('better-sqlite3')` riesce **anche con l'ABI sbagliata**: `bindings` carica il `.node` solo al primo `new Database()`. Per provarlo, istanzia — e usa l'ABI di Electron: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -e "new (require('better-sqlite3'))(':memory:')"` |
| Cross-build fra piattaforme | `package:win` e `package:linux` ricompilano `better-sqlite3` per il target e ce lo lasciano. Dopo, `npm run dev` muore con `NODE_MODULE_VERSION mismatch`: rimettere a posto con `electron-builder install-app-deps` |
| `npm install` con npm 11 | Gli install script delle dipendenze sono bloccati finché non stanno in `allowScripts` di `package.json`. `npm install` lo dice in **una riga di `warn`** in mezzo all'output e prosegue: `npm install-scripts ls` mostra chi manca. Il `postinstall` del progetto rimedia per better-sqlite3, **non** per il binario di Electron. L'approvazione è **appuntata alla versione** (`better-sqlite3@11.10.0`), quindi un aggiornamento di dipendenza la fa decadere in silenzio. E `npm install-scripts approve --dry-run` non è un dry run: scrive comunque in `package.json` |
| `npx <binario>` con la dipendenza mancante | Non fallisce: **scarica un pacchetto diverso da internet** e lo esegue. `npx vitest run` senza vitest installato tira giù una vite qualsiasi e muore con `Cannot find module 'vitest/config'`, che sembra un config rotto e non un `node_modules` monco. Usare gli script di `package.json` (`npm test`), che passano dal binario locale o non partono |
| Vitest e il modulo nativo | Vitest gira su Node, `better-sqlite3` è compilato per l'ABI di Electron: un test che lo importa muore con `NODE_MODULE_VERSION mismatch`. Non ricompilare avanti e indietro — è il segnale che la logica sta nel posto sbagliato (vedi Test) |
| electron-vite | `externalizeDepsPlugin()` in `main` e `preload`, o la build fallisce in modo illeggibile |
| `"type": "module"` in `package.json` | Non rimetterlo. Fa emettere a electron-vite un main ESM, e `import { BrowserWindow } from 'electron'` esplode all'istanziazione: `electron` è CJS con getter pigri. Muore con **codice 0 e stderr vuoto** dal pacchetto. Vitest lo consiglia a ogni esecuzione: ignoralo |
| Percorso dei dati utente | `app.getPath('userData')` deriva da `app.getName()`, che legge `package.json`. `productName` nell'`electron-builder.yml` a runtime non esiste: senza `productName` anche in `package.json`, sviluppo e app installata scrivono nello stesso database |
| `ELECTRON_RUN_AS_NODE` | VS Code lo esporta a `1` nei suoi terminali, su entrambe le macchine. Electron esegue il main come Node normale: `require('electron').app` è `undefined` e l'app muore con `Cannot read properties of undefined (reading 'isPackaged')`. Lanciarla con `env -u ELECTRON_RUN_AS_NODE` |
| Finestra occlusa e protocollo DevTools | Quando il terminale prende il fuoco la finestra va in `visibilityState: hidden`: niente `requestAnimationFrame` e **niente eventi `scroll`**. Una lista virtualizzata sembra congelata sulle prime venti righe e si "scopre" un difetto che non c'è. Portarla davanti (`osascript -e 'tell application "Fanta Help" to activate'`) o emettere `dispatchEvent(new Event('scroll'))` a mano |
| `@theme inline` di Tailwind | Elimina le variabili che nessuna utility usa. Una mappatura sbagliata **non compare** nel CSS costruito e sembra assente: si sveglia al primo componente che la tocca |
| Spazi dei nomi di Tailwind v4 | Ogni famiglia di utility ne ha uno obbligatorio: `--color-*` per i colori, `--radius-*` per i raggi, `--text-*` per i corpi. Un nome fuori namespace in `@theme` **non genera niente e non dà errore**: un `--radius` nudo riporta ogni `rounded-md` a 6px, e un primitivo senza `--color-` spegne in silenzio ogni `bg-…`/`text-…` che lo usa. I documenti scrivono i token senza prefisso: `base.css` fa da ponte, e chi ne aggiunge uno deve estendere il ponte |
| CLI di shadcn | Senza `paths` nel `tsconfig.json` di radice non fallisce: crea una cartella chiamata letteralmente `@` |
| React Router su `file://` | `HashRouter`, mai `BrowserRouter` |
| `F11` | È già lo schermo intero di sistema. Il modo proiezione usa `Ctrl/Cmd+P` |
| Documento riscritto da una copia vecchia | Su un file lungo, modificarlo da una copia stantia invece che da `HEAD` non dà nessun conflitto: il diff mostra le perdite come se fossero cancellazioni decise. Si riconosce con `git diff --numstat <commit-lontano> HEAD -- <file>`: **0 rimozioni** contro una base di parecchi commit fa vuol dire che il file è quella base più le aggiunte, e tutto il lavoro in mezzo è sparito. Il rimedio è ricostruire il commit, non rattoppare i sintomi |
| Comando Bash negato | Se il permesso viene negato, **non è stato eseguito niente**, nemmeno le parti prima della `&&`. Un `git add … && git commit …` negato lascia l'indice intatto, e il commit successivo prende quello vecchio: sembra riuscito e gli mancano i file. Tenere `add` e `commit` in due chiamate, e guardare `git status` dopo ogni negazione |

---

## Convenzioni

**Lingua.** Codice, identificatori, commenti e nomi di file in **inglese**. Testi rivolti all'utente in **italiano**. I messaggi d'errore stanno in `src/shared/errors.ts` accanto al codice, mai sparsi nei componenti.

**Errori.** Mai eccezioni attraverso il confine IPC. Sempre l'involucro `Result<T>` con un codice. Un servizio che rifiuta chiama `raise('CODICE', {…})` da `shared/errors.ts`: un `throw new Error` qualsiasi arriva al renderer come `UNKNOWN`, e il messaggio giusto sparisce senza che niente fallisca. Lo stesso vale per ciò che **non** hai lanciato tu: un vincolo che lo schema zod non sa esprimere lo fa rispettare SQLite, e un `UNIQUE constraint failed` da dentro una transazione arriva come `UNKNOWN` dopo che l'anteprima aveva dichiarato il file buono. Se una tabella ha un `UNIQUE`, lo schema che la alimenta deve averlo.

**Scrittura.** Ogni scrittura che tocca più tabelle sta in una transazione. Se fra il controllo di un'invariante e la scrittura che protegge c'è un `await`, il controllo va rifatto **dentro** la transazione: `ipcMain.handle` non serializza le invoke, e una guardia separata dalla sua scrittura da un'attesa protegge il passato.

**Interazione.** Tutto ciò su cui si clicca ha il cursore a mano, e ciò che è disabilitato no. La regola sta una volta sola in `base.css` come selettore globale, non componente per componente: appiccicata a mano, il primo che se la dimentica produce un elemento che sembra inerte, e nessun test dell'interfaccia esiste per accorgersene.

**Formato d'interscambio.** Un campo aggiunto al dataset è additivo e il **lettore** lo tratta come opzionale; solo un cambiamento che invalida i file vecchi alza `formatVersion`. Aggiungerlo obbligatorio senza alzare il numero rende illeggibile tutto ciò che è stato pubblicato prima, mentre il file continua a dichiararsi della stessa versione.

**Copy dell'interfaccia.** Un errore dice cosa è successo e cosa fare, non si scusa. Uno stato vuoto è un invito ad agire. Intestazioni di colonna e valori in minuscolo, titoli di vista e di sezione in sentence case, acronimi con le maiuscole — ma un troncamento non è un acronimo: `FVM`, `MV`, `Pv`, `CS` restano maiuscoli, `qt.`, `bon`, `tit.`, `min` no. Mai maiuscolo spaziato.

---

## Test

Poco e mirato. Non serve copertura, servono questi:

- Le invarianti dei servizi d'asta, in particolare la puntata massima e la regola di completabilità.
- La serializzazione canonica dello snapshot: lo stesso contenuto con le chiavi in ordine diverso deve produrre lo stesso hash. Se si rompe, si rompe in silenzio.
- La copertura dei canali IPC: la lista dei contratti e quella degli handler registrati devono coincidere.

Niente test sull'interfaccia in v1.

**Una guardia che non scatta mai** è indistinguibile da un dato sempre pulito. Dopo averne scritta una, rompila apposta e rilancia i test: se passano lo stesso, il test non c'è.

Tre modi in cui quella prova mente, incontrati tutti e tre:

- **Un file di test che non compila mostra *meno* test, non test che falliscono.** Se la mutazione rompe la sintassi, Vitest scarta il file e il totale cala: `21 passed (21)` dove prima erano 29 non è una guardia inerte, è una prova non eseguita. Guardare il totale, non solo i falliti.
- **Cambiare il ruolo di un dato ne cambia la soglia di correttezza.** Un valore usato come *spareggio* può essere sbagliato senza conseguenze — non pareggia con nessuno; lo stesso valore usato come *veto* rifiuta tutto. `Number('')` è `0` e `Number.isInteger(0)` è vero, quindi «anno assente» si legge «anno zero»: innocuo per anni, fatale il giorno che l'anno acquista il potere di dire di no.
- **Il caso che dài alla guardia può non esistere nei dati.** È il modo peggiore, perché la mutazione fallisce come deve e la prova sembra riuscita. In T10 `hasHistory({})` passava, la mutazione la faceva fallire, e la guardia non è mai scattata su nessuno dei 524 giocatori: `{}` non esiste, perché la riga della stagione in corso ce l'hanno tutti e porta **zeri, non null**. La mutazione prova che il test guarda *qualcosa*, non che guardi il caso vero. Il fissato va preso dal dataset costruito, non inventato.

**I numeri nei documenti sono specifiche eseguibili.** Quando un documento dà un conteggio — «108 giocatori su 524», «0 Id cambiati su 589» — quel numero *è* il test, ed è più forte di qualunque caso scritto a mano. `src/shared/domain.ts` è puro, quindi si esegue sul dataset vero senza Vitest e senza l'app: `node --experimental-strip-types` su uno script che importa la funzione e apre `tools/dataset/output/<stagione>/v1.json.gz`. Se il conteggio non torna, la guardia è sbagliata anche se i test sono verdi.

**Il guardrail.** I test girano su Node, quindi non possono toccare il database. Se un test ha bisogno di importare `better-sqlite3`, `electron` o qualcosa da `src/main/db/`, non è il test a essere sbagliato: è la logica che sta nel posto sbagliato e va spostata in `src/shared/domain.ts` come funzione pura. Le invarianti che contano sono aritmetica su crediti e slot: non hanno bisogno di SQLite.

---

## Due macchine

Il progetto si sviluppa su **Fedora x64** e su **macOS arm64**, sempre dalla stessa persona e mai in parallelo. Quello che ne segue:

- **Niente piattaforma cablata negli strumenti.** L'architettura si ricava da `uname -m`, il binario di Electron da `node_modules/electron/dist/path.txt`. Un percorso scritto a mano funziona su una macchina e sull'altra muore con un `No such file or directory` che sembra un'installazione rotta.
- **Il database non viaggia.** `userData` sta in posti diversi su dischi diversi: una lega preparata di qua non si trova di là. Per spostare una sessione serve l'export/import JSON di T18, non una copia di file.
- **Un `pull` non porta `node_modules`.** Tirando giù il lavoro fatto sull'altra macchina, l'albero è aggiornato e le dipendenze sono ferme a prima: mancano esattamente quelle aggiunte nei task nel frattempo. Il sintomo è un comando che non esiste o un import che non risolve, e sembra un'installazione rotta. `npm ci` e poi `electron-builder install-app-deps`.
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

