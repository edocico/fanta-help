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
| `identity_key` è la stessa in ogni stagione | È `fc-<sourceId>` e `player` è unica su `(season_id, source_id)`: **lo stesso giocatore ha la stessa chiave in ogni listone**, ed è il punto della riconciliazione del documento 4 §5. Qualunque ricerca che risolva un giocatore da una chiave esterna deve filtrare anche per stagione, o con due listoni installati aggancia l'anno sbagliato — club e ruolo compresi, quindi cadono le invarianti 7 e 6 insieme e in silenzio. Non si vede provandolo: il database di sviluppo ha **una stagione sola**, e con una sola la query sbagliata dà la risposta giusta |
| Migrazioni già applicate | Il migratore confronta solo il timestamp dell'**ultima** riga di `__drizzle_migrations`, e l'hash lo scrive senza mai rileggerlo. Modificare un `.sql` già applicato è un no-op silenzioso: funziona su un database nuovo e non su nessuno esistente. Ogni statement in più va in un file numerato nuovo |
| Migrazioni Drizzle in produzione | Percorso relativo → finisce in `app.asar` e fallisce su `meta/_journal.json`. Usare percorso assoluto e spedire `drizzle/` in `extraResources` |
| Dove va una dipendenza | Dipende da chi la importa, e le due metà sbagliano in direzioni opposte. **Main e preload** usano `externalizeDepsPlugin()`: non vengono impacchettate, quindi si caricano a runtime da `node_modules` e devono stare in `dependencies` — electron-builder **pota le devDependencies**, quindi da lì funzionerebbero in sviluppo e morirebbero nel pacchetto (successo con `exceljs`). **Il renderer** invece viene impacchettato da Vite: le sue librerie finiscono nel bundle e in `dependencies` verrebbero spedite due volte. Per questo `react` sta fra le dev, e con lui TanStack e uFuzzy |
| better-sqlite3 | Modulo nativo. `asarUnpack` deve includere anche `bindings` e `file-uri-to-path`, o l'app parte in dev e crolla in produzione |
| Verificare il modulo nativo | `require('better-sqlite3')` riesce **anche con l'ABI sbagliata**: `bindings` carica il `.node` solo al primo `new Database()`. Per provarlo, istanzia — e usa l'ABI di Electron: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/$(cat node_modules/electron/path.txt) -e "new (require('better-sqlite3'))(':memory:')"` |
| Cross-build fra piattaforme | `package:win` e `package:linux` ricompilano `better-sqlite3` per il target e ce lo lasciano. Dopo, `npm run dev` muore con `NODE_MODULE_VERSION mismatch`: rimettere a posto con `electron-builder install-app-deps` |
| `npm install` con npm 11 | Gli install script delle dipendenze sono bloccati finché non stanno in `allowScripts` di `package.json`. `npm install` lo dice in **una riga di `warn`** in mezzo all'output e prosegue: `npm install-scripts ls` mostra chi manca. Il `postinstall` del progetto rimedia per better-sqlite3, **non** per il binario di Electron. L'approvazione è **appuntata alla versione** (`better-sqlite3@11.10.0`), quindi un aggiornamento di dipendenza la fa decadere in silenzio. E `npm install-scripts approve --dry-run` non è un dry run: scrive comunque in `package.json` |
| `npx <binario>` con la dipendenza mancante | Non fallisce: **scarica un pacchetto diverso da internet** e lo esegue. `npx vitest run` senza vitest installato tira giù una vite qualsiasi e muore con `Cannot find module 'vitest/config'`, che sembra un config rotto e non un `node_modules` monco. Usare gli script di `package.json` (`npm test`), che passano dal binario locale o non partono |
| Vitest e il modulo nativo | Vitest gira su Node, `better-sqlite3` è compilato per l'ABI di Electron: un test che lo importa muore con `NODE_MODULE_VERSION mismatch`. Non ricompilare avanti e indietro — è il segnale che la logica sta nel posto sbagliato (vedi Test) |
| `console.log` dentro un test Vitest | Non compare, e il test passa lo stesso: sembra che il blocco non sia stato eseguito. `process.stdout.write` invece passa — verificato con le due righe affiancate nello stesso test. Vale per lo script usa-e-getta che misura una funzione pura contro il dataset vero, che è il modo in cui questa repo verifica i numeri dei documenti |
| electron-vite | `externalizeDepsPlugin()` in `main` e `preload`, o la build fallisce in modo illeggibile |
| `"type": "module"` in `package.json` | Non rimetterlo. Fa emettere a electron-vite un main ESM, e `import { BrowserWindow } from 'electron'` esplode all'istanziazione: `electron` è CJS con getter pigri. Muore con **codice 0 e stderr vuoto** dal pacchetto. Vitest lo consiglia a ogni esecuzione: ignoralo |
| Percorso dei dati utente | `app.getPath('userData')` deriva da `app.getName()`, che legge `package.json`. `productName` nell'`electron-builder.yml` a runtime non esiste: senza `productName` anche in `package.json`, sviluppo e app installata scrivono nello stesso database |
| `ELECTRON_RUN_AS_NODE` | VS Code lo esporta a `1` nei suoi terminali, su entrambe le macchine. Electron esegue il main come Node normale: `require('electron').app` è `undefined` e l'app muore con `Cannot read properties of undefined (reading 'isPackaged')`. Lanciarla con `env -u ELECTRON_RUN_AS_NODE` |
| Finestra occlusa e protocollo DevTools | Quando il terminale prende il fuoco la finestra va in `visibilityState: hidden`: niente `requestAnimationFrame` e **niente eventi `scroll`**. Una lista virtualizzata sembra congelata sulle prime venti righe e si "scopre" un difetto che non c'è. Portarla davanti (`osascript -e 'tell application "Fanta Help" to activate'`) o emettere `dispatchEvent(new Event('scroll'))` a mano |
| Finestra occlusa e passaggi di fuoco | Stessa causa della riga sopra, conseguenza peggiore: dentro un `requestAnimationFrame` **niente parte**, quindi un `focus()` rimandato a rAF per aspettare che un campo smetta di essere `disabled` non avviene mai. In T14 il primo `Invio` sceglieva il giocatore e il fuoco restava nella ricerca: le cifre del prezzo finivano nel nome, «dima» diventava «dima31» e appariva «Nessun giocatore» — un difetto che a finestra davanti non esiste. Il rimedio non è portare avanti la finestra: è **non usare rAF**. Un `useEffect` sullo stato che ha abilitato il campo gira sul commit, occlusa o no |
| `@theme inline` di Tailwind | Elimina le variabili che nessuna utility usa. Una mappatura sbagliata **non compare** nel CSS costruito e sembra assente: si sveglia al primo componente che la tocca |
| Spazi dei nomi di Tailwind v4 | Ogni famiglia di utility ne ha uno obbligatorio: `--color-*` per i colori, `--radius-*` per i raggi, `--text-*` per i corpi. Un nome fuori namespace in `@theme` **non genera niente e non dà errore**: un `--radius` nudo riporta ogni `rounded-md` a 6px, e un primitivo senza `--color-` spegne in silenzio ogni `bg-…`/`text-…` che lo usa. I documenti scrivono i token senza prefisso: `base.css` fa da ponte, e chi ne aggiunge uno deve estendere il ponte |
| Utility assente dal CSS costruito | Tailwind emette solo quello che **vede usato**: `text-micro` non compare finché nessun file la scrive, quindi cercarla e non trovarla non prova che il token sia rotto. Per provare un token nuovo serve un uso vero, anche finto. È il rovescio della trappola di `@theme inline`: là sparisce la variabile che nessuna utility usa, qua non nasce la regola che nessun file scrive |
| CLI di shadcn | Senza `paths` nel `tsconfig.json` di radice non fallisce: crea una cartella chiamata letteralmente `@` |
| React Router su `file://` | `HashRouter`, mai `BrowserRouter` |
| `F11` | È già lo schermo intero di sistema. Il modo proiezione usa `Ctrl/Cmd+P` |
| Documento riscritto da una copia vecchia | Su un file lungo, modificarlo da una copia stantia invece che da `HEAD` non dà nessun conflitto: il diff mostra le perdite come se fossero cancellazioni decise. Si riconosce con `git diff --numstat <commit-lontano> HEAD -- <file>`: **0 rimozioni** contro una base di parecchi commit fa vuol dire che il file è quella base più le aggiunte, e tutto il lavoro in mezzo è sparito. Il rimedio è ricostruire il commit, non rattoppare i sintomi |
| Campo che consegna al blur | Un input che tiene il testo e lo passa al genitore solo al blur ha due modi di mentire, e nessuno dei due si vede leggendo il codice. **Se il bottone che segue è disabilitato finché quel valore non arriva**, chi scrive e clicca fa partire il blur col bottone ancora spento e il click può non arrivare mai: sembra un bottone morto. E **se la scrittura viene rifiutata**, il valore che torna dall'alto è quello di prima, quindi il campo non si risincronizza e resta a mostrare proprio il nome che il messaggio d'errore sopra ha appena respinto. Rimedi: consegnare a ogni battuta dove non c'è niente da salvare (una bozza in memoria), e rimontare la lista con una `key` che cambia a ogni rifiuto |
| Stato con un lettore solo | Smontare un componente può orfanare uno stato che nessun altro stampa. In T15 il rifiuto di `Ctrl/Cmd+Z` aveva come unico lettore il pannello di assegnazione, che la proiezione smonta: il tasto restava vivo, poteva ancora fallire, e rispondeva col silenzio — indistinguibile da un tasto rotto. Typecheck verde, perché la prop esiste ed è passata: manca solo il ramo che la legge. Quando una modalità smonta qualcosa, chiedersi cosa quel qualcosa era l'unico a dire |
| Breakpoint che la finestra non raggiunge mai | La finestra si apre a **900×620** (`main/index.ts`) e ogni utility `lg:` parte da 1024: quello che sta dietro un `lg:` non si vede mai alla dimensione predefinita. Compila, passa il typecheck, e la funzione sembra fatta. In T12 ci è finito il confronto fra due piani, che il documento 2 §4.7 chiede |
| Taglie di un layout calcolate a mente | Sommare padding, corpo e interlinea dà numeri sbagliati di parecchio: ignora come il flex distribuisce lo spazio davvero. In T15 la stima dava righe da 47px e undici visibili, la misura ne ha date **59 e otto**; e sul televisore prometteva dodici squadre quando ne entravano **sei**. Peggio: il primo gradino del modo proiezione, scritto per essere «uguale a oggi», produceva righe da 44.5px contro 59 — la modalità che dice «ingrandisce» era più *fitta* di quella normale, e nessuna rilettura del codice se n'era accorta. Si misura con `getBoundingClientRect()` nell'app in esecuzione, e il numero misurato va nel commento accanto ai valori |
| `truncate` che non tronca | `truncate` taglia solo se un antenato costringe la larghezza. Dentro una catena di `shrink-0` nessuno lo fa: il flex item tiene `min-width: auto` e conserva la larghezza intrinseca. In T14 un nome di squadra da 47 caratteri misurava 363px e la barra dell'asta ne chiedeva 922 su 860, con i bottoni di conferma fuori dalla finestra. Serve `min-w-0` sul genitore, o niente `shrink-0` |
| La riga fantasma del virtualizzatore | Il primo `tbody tr` della vista Giocatori è lo spaziatore di `@tanstack/react-virtual`: `<tr style="height:0px">` senza celle. `document.querySelector('tbody tr').click()` clicca il vuoto e sembra che il pannello non si apra più. Prendere la prima riga con `tr.cells.length > 3`. Stesso genere: `document.querySelectorAll('select')[0]` è il selettore di lega della barra laterale, non il primo select della pagina |
| Guidare l'interfaccia da DevTools | Scrivere in un input col setter nativo **non gli dà il fuoco**, quindi un `blur()` dopo non fa scattare niente e la modifica non parte mai. Il DOM mostra il testo, il modello non l'ha ricevuto, e sembra un difetto dell'app: in T11 ha finto due volte un bug che non c'era. Mettere `el.focus()` prima di scrivere — e non basta: **con la finestra non a fuoco** (`document.hasFocus()` falso, che è la regola quando a guidare è un terminale) `el.focus()` sposta `document.activeElement` ma il `blur()` successivo non emette nessun `focusout`, quindi l'`onBlur` di React tace lo stesso. Emettere `new FocusEvent('focusout', { bubbles: true })` a mano, o portare davanti la finestra |
| Guidare l'app che sta usando anche l'utente | La finestra è una sola e il DOM non dice chi ha premuto. In T15 sono comparsi una bozza che non avevo digitato, un acquisto che non avevo fatto e due `Cmd+P` di fila che «non commutavano»: erano battute dell'utente in mezzo alle mie, e sembravano difetti dell'app. Dire che si sta guidando prima di misurare, e leggere lo stato **prima e dopo** ogni gesto, non solo dopo. Un `keydown` sintetico via `evaluate_script` prova il gestore indipendentemente da chi ha la tastiera |
| Dialoghi nativi mentre guidi l'app | `showSaveDialog` e `showOpenDialog` bloccano il thread e da DevTools non si chiudono: cliccare il bottone che li apre appende la sessione. Si prova il servizio dietro il dialogo — che riceve il percorso come argomento — e si lascia il selettore alla lettura. Vale per l'export e per l'import di T18 |
| `resize_page` sotto Electron | Chiede `Browser.getWindowForTarget`, che Electron non implementa: risponde «wasn't found» e sembra un server MCP guasto. Per cambiare dimensione si usa `emulate` con `viewport: "<larghezza>x<altezza>x1"`, che muove le media query per davvero |
| Un servizio provato con `ctx as any` | Il modello di `/prova-servizio` usa `as any` **per drizzle**, non per saltare il contesto: le funzioni che un servizio riceve da `ctx` — `readGrid`, `backup`, `chooseSnapshot` — restano `undefined`, la chiamata lancia, e il servizio la converte nel proprio rifiuto. `importListone` ha risposto `XLSX_UNREADABLE` su un listone valido, che si legge come un difetto dell'app e non dell'harness. Prima di chiamare un servizio, elencare cosa legge da `ctx` |
| Provare un passo irreversibile | Gli stati della lega vanno solo avanti (`auction` → `review` → `closed`): aprire l'asta per guardarla brucia la lega del database di sviluppo. Si lavora su una copia — `cp -R` di `userData` e `--user-data-dir` — ma il main fa `app.setPath('userData', … + ' (dev)')`, quindi la copia va messa in `<dir> (dev)` e non in `<dir>`. Sbagliando, l'app parte su un database **nuovo e vuoto**: `league.list` torna `[]` e sembra che la copia non sia riuscita |
| Testo italiano dentro uno script bash | Un apostrofo dentro un'espansione — `${1:?serve il file dell'harness}` — apre una virgoletta che non si chiude, e lo script muore all'esecuzione con «EOF non atteso», non mentre lo scrivi. `bash -n` prima di consegnarlo. Vale per hook e skill, che qui sono tutti commentati in italiano |
| Componente riusato da un'altra fase | Riusarlo porta con sé le sue **regole**, non solo il suo aspetto. In T16 il pannello d'asta riusato nella revisione calcolava ancora le invarianti come `blocking`: il servizio accettava e il bottone restava spento, quindi l'unica cosa che il §4.10 chiede davvero — spostare un giocatore su una squadra già sforata — era impossibile. Typecheck verde, test verdi, e nemmeno provarlo nell'app lo trova, se la squadra su cui provi ha crediti e slot liberi. Prima di riusare un componente, elencare cosa **decide** oltre a cosa mostra: severità, filtri, precompilazioni. Nello stesso pannello il campo squadra si precompilava col turno rimasto dall'asta, che in revisione non è il turno di nessuno |
| `pgrep -f` non è più sicuro di `pkill -f` | La riga di `.claude.local.md` vieta `pkill -f <pattern>` dal tool Bash perché il pattern combacia con la shell che lo esegue. **Vale identico per `pgrep -f <pattern> | while read p; do kill $p; done`**, che è la stessa cosa scritta in due comandi: la lista contiene il PID del wrapper, il ciclo lo uccide, l'uscita è 144 e i passi dopo non girano. Preso di nuovo chiudendo il pacchetto di fine fase 6. Chiudere per PID esplicito, letto e stampato prima |
| Nomi del documento 7 che cadono in un namespace di Tailwind | I semantici del §3 si chiamano `--text`, `--text-strong`, `--text-muted`, `--text-disabled`, e sono **colori** — ma `--text-*` è lo spazio dei nomi delle **taglie**. Finché stanno in `:root` non c'è problema. Spostati in `@theme` perché «i semantici stanno lì», Tailwind li legge come taglie a prescindere dal valore: provato, `--text-provacolore: var(--chalk-400)` genera `font-size: var(--text-provacolore)`, il browser scarta una lunghezza che è un colore, e l'elemento resta com'era. Classe presente, regola presente, effetto zero. È la trappola gemella del `--radius` nudo, dal lato opposto: là il nome era fuori namespace e non generava niente, qua è **dentro** quello sbagliato e genera qualcosa di morto |
| Contare con `grep` un token che è prefisso di un altro | Il trattino è un confine di parola, quindi `text-chalk\b` combacia **dentro** `text-chalk-dim`: il conteggio esce 284 dove il vero è 54, e nessuna delle due cifre sembra assurda. Stessa forma su un file costruito, dove `.text-muted` combacia dentro `.text-muted-foreground` e fa sembrare generata una regola che non c'è. Qui i conteggi finiscono nei documenti come specifiche, quindi il numero sbagliato **è** la specifica sbagliata. Alternanza ordinata dal token più lungo al più corto, e `(?![-\w])` al posto di `\b` |
| Una proporzione asserita invece che misurata | «Ed è la maggioranza» è un numero travestito da aggettivo, e non fallisce niente quando è rovesciato. In T14b il commento diceva che le due fonti dei nomi coincidono per la maggior parte del listone: sono **407 nomi su 524 di una parola sola**, e FBref ci mette il nome davanti a tutti, quindi coincidono quasi mai. Peggio, quella frase **reggeva una scelta di layout** — «inline e non su due righe, tanto riguarda poche righe» — che riguardava quasi tutte le righe, e il codice trenta righe più in là diceva già il contrario (`almost every row has one`). Si riconosce rileggendo la propria modifica come se fosse di un altro e cercando i giudizi di quantità: ognuno va sostituito col conteggio, che `src/shared/domain.ts` è puro e si esegue sul dataset vero in un `node -e`. L'ha presa `revisore-fase`, non il typecheck e non i test |
| Sezione aggiunta a un documento letto a metà | Aprire un file lungo, leggere le prime settanta righe e aggiungere una sezione produce un doppione che **litiga con l'originale**, non un doppione innocuo: il `README` della pipeline è finito con due «Gli stadi facoltativi», una che diceva dodici CSV e una che diceva nove, e l'indice le mostrava entrambe. Non è la trappola del documento riscritto da una copia vecchia — lì si perde del testo, qui se ne aggiunge del contraddittorio, e `git diff` mostra solo la metà nuova, che è giusta. Prima di aggiungere una sezione, `grep -n '^## '` sul file intero |
| Comando Bash negato | Se il permesso viene negato, **non è stato eseguito niente**, nemmeno le parti prima della `&&`. Un `git add … && git commit …` negato lascia l'indice intatto, e il commit successivo prende quello vecchio: sembra riuscito e gli mancano i file. Tenere `add` e `commit` in due chiamate, e guardare `git status` dopo ogni negazione |

---

## Convenzioni

**Lingua.** Codice, identificatori, commenti e nomi di file in **inglese**. Testi rivolti all'utente in **italiano**. I messaggi d'errore stanno in `src/shared/errors.ts` accanto al codice, mai sparsi nei componenti.

**Errori.** Mai eccezioni attraverso il confine IPC. Sempre l'involucro `Result<T>` con un codice. Un servizio che rifiuta chiama `raise('CODICE', {…})` da `shared/errors.ts`: un `throw new Error` qualsiasi arriva al renderer come `UNKNOWN`, e il messaggio giusto sparisce senza che niente fallisca. Lo stesso vale per ciò che **non** hai lanciato tu: un vincolo che lo schema zod non sa esprimere lo fa rispettare SQLite, e un `UNIQUE constraint failed` da dentro una transazione arriva come `UNKNOWN` dopo che l'anteprima aveva dichiarato il file buono. Se una tabella ha un `UNIQUE`, lo schema che la alimenta deve averlo. E i parametri di un messaggio sono controllati solo se chi li produce è tipizzato **per codice**: un `detail: Record<string, number>` fa passare `detail.n` anche dove `n` non esiste, e il rifiuto dice «ha undefined crediti» con typecheck e test verdi. `Violation` in `domain.ts` è un'unione discriminata per questo.

**Scrittura.** Ogni scrittura che tocca più tabelle sta in una transazione. Se fra il controllo di un'invariante e la scrittura che protegge c'è un `await`, il controllo va rifatto **dentro** la transazione: `ipcMain.handle` non serializza le invoke, e una guardia separata dalla sua scrittura da un'attesa protegge il passato.

**Interazione.** Tutto ciò su cui si clicca ha il cursore a mano, e ciò che è disabilitato no. La regola sta una volta sola in `base.css` come selettore globale, non componente per componente: appiccicata a mano, il primo che se la dimentica produce un elemento che sembra inerte, e nessun test dell'interfaccia esiste per accorgersene.

**Formato d'interscambio.** Un campo aggiunto al dataset è additivo e il **lettore** lo tratta come opzionale; solo un cambiamento che invalida i file vecchi alza `formatVersion`. Aggiungerlo obbligatorio senza alzare il numero rende illeggibile tutto ciò che è stato pubblicato prima, mentre il file continua a dichiararsi della stessa versione.

**Copy dell'interfaccia.** Un messaggio che conta sa contare fino a **uno e a zero**: «ha già 1 difensori» e «ha già 0 portieri» sono usciti da tre codici diversi in tre task di fila, e la terza volta l'ha preso la revisione. `ROLE_LABELS` e `ROLE_LABELS_ONE` in `domain.ts` esistono per questo. E il ramo singolare deve coprire anche quello che sta **fuori** dal frammento: «1 anomalia aperte» e «1 versione cristallizzate» sono passate perché il ramo c'era per il sostantivo e la concordanza era scritta accanto. Dove l'aggettivo non serve, la via corta è toglierlo. Un errore dice cosa è successo e cosa fare, non si scusa. Uno stato vuoto è un invito ad agire. Intestazioni di colonna e valori in minuscolo, titoli di vista e di sezione in sentence case, acronimi con le maiuscole — ma un troncamento non è un acronimo: `FVM`, `MV`, `Pv`, `CS` restano maiuscoli, `qt.`, `bon`, `tit.`, `min` no. Mai maiuscolo spaziato.

---

## Test

Poco e mirato. Non serve copertura, servono questi:

- Le invarianti dei servizi d'asta, in particolare la puntata massima e la regola di completabilità.
- La serializzazione canonica dello snapshot: lo stesso contenuto con le chiavi in ordine diverso deve produrre lo stesso hash. Se si rompe, si rompe in silenzio.
- La copertura dei canali IPC: la lista dei contratti e quella degli handler registrati devono coincidere.

Niente test sull'interfaccia in v1.

**Una guardia che non scatta mai** è indistinguibile da un dato sempre pulito. Dopo averne scritta una, rompila apposta e rilancia i test: se passano lo stesso, il test non c'è. Il giro lo fa **`/muta`**, che distingue la guardia inerte dall'espressione che non ha combaciato e dal file scartato — a occhio sono la stessa riga verde.

Cinque modi in cui quella prova mente, incontrati tutti:

- **Un file di test che non compila mostra *meno* test, non test che falliscono.** Se la mutazione rompe la sintassi, Vitest scarta il file e il totale cala: `21 passed (21)` dove prima erano 29 non è una guardia inerte, è una prova non eseguita. Guardare il totale, non solo i falliti.
- **Cambiare il ruolo di un dato ne cambia la soglia di correttezza.** Un valore usato come *spareggio* può essere sbagliato senza conseguenze — non pareggia con nessuno; lo stesso valore usato come *veto* rifiuta tutto. `Number('')` è `0` e `Number.isInteger(0)` è vero, quindi «anno assente» si legge «anno zero»: innocuo per anni, fatale il giorno che l'anno acquista il potere di dire di no.
- **La guardia può essere irraggiungibile per costruzione.** La mutazione sopravvive, e non c'è nessun test da aggiungere: è la riga a non servire. `permutationOf` controllava i doppioni dopo un controllo di appartenenza che li prendeva già tutti; `planCells` metteva un `Math.max(0, …)` su una differenza che uno `slice` teneva già non negativa. Il rimedio non è un test più contorto: è far dire alla funzione quello che intende davvero — o togliere la riga.
- **Un test che confronta due uscite della stessa funzione non fissa niente.** In T17 le prove della serializzazione canonica confrontavano `canonicalize(x)` con `canonicalize(y)`, e a un confronto così va bene **qualunque** ordine purché sia sempre lo stesso: la mutazione che inverte il verso dell'ordinamento per `uuid` è sopravvissuta a tutte. Un'uguaglianza prova che la funzione è deterministica, non *quale* forma produce — e la forma è il contratto, perché un domani un'altra implementazione dovrà dare la stessa impronta sugli stessi dati. Il rimedio è un valore d'oro: la stringa esatta, scritta per intero.
- **Il caso che dài alla guardia può non esistere nei dati.** È il modo peggiore, perché la mutazione fallisce come deve e la prova sembra riuscita. In T10 `hasHistory({})` passava, la mutazione la faceva fallire, e la guardia non è mai scattata su nessuno dei 524 giocatori: `{}` non esiste, perché la riga della stagione in corso **ce l'hanno tutti**. Cosa ci sia dentro invece cambia nel tempo, ed è la metà che invecchia: misurata in T12b, quella riga porta una o due giornate vere per **328 giocatori su 524** — il campionato è cominciato — e `Pv 0` con MV **null** per gli altri 196. Nessuna riga di soli zeri. Un punteggio calcolato su quella stagione faceva primo in Italia, per un fattore due, un attaccante con tre gol nella sua unica presenza. La mutazione prova che il test guarda *qualcosa*, non che guardi il caso vero. Il fissato va preso dal dataset costruito, non inventato. Vale anche guidando l'app: il listone nomina **per cognome**, con un'abbreviazione del nome quando è ambiguo (89 nomi su 524 nel 2026-27, perché ci sono due Martinez, due Thuram, due Pellegrini — e non sempre una lettera basta: `Esposito F.P.`, `Pessina Mas.`). Cercare `lauta` sembrava una ricerca rotta: la voce è `Martinez L.`, e il fissato era scelto a memoria invece che dal dataset. T14b ha dato alla ricerca anche il nome per esteso, quindi ora `lauta` trova — **ma solo se lo stadio FBref ha girato e ha agganciato quel giocatore**, e il fatto sotto non è cambiato: la colonna `name` resta il cognome, ed è ancora da lì che si prende un fissato.

**I numeri nei documenti sono specifiche eseguibili.** Quando un documento dà un conteggio — «108 giocatori su 524», «0 Id cambiati su 589» — quel numero *è* il test, ed è più forte di qualunque caso scritto a mano. `src/shared/domain.ts` è puro, quindi si esegue sul dataset vero senza Vitest e senza l'app: `node --experimental-strip-types` su uno script che importa la funzione e apre `tools/dataset/output/<stagione>/v1.json.gz`. Se il conteggio non torna, la guardia è sbagliata anche se i test sono verdi.

**Il guardrail.** I test girano su Node, quindi non possono toccare il database. Se un test ha bisogno di importare `better-sqlite3`, `electron` o qualcosa da `src/main/db/`, non è il test a essere sbagliato: è la logica che sta nel posto sbagliato e va spostata in `src/shared/domain.ts` come funzione pura. Le invarianti che contano sono aritmetica su crediti e slot: non hanno bisogno di SQLite.

**Provare un servizio del main.** Il guardrail vale per Vitest, non per te. I difetti che i tipi non vedono — un rifiuto senza il suo messaggio, una transazione che non torna indietro, una grammatica che non sa contare fino a uno — escono solo esercitando il servizio vero su un database di scorta, ed è così che T12 e T13 li hanno trovati. Lo fa **`/prova-servizio`**: copi il modello, scrivi le prove in fondo, lo lanci. Il documento 6 §5 chiama questa strada «uno script separato eseguito sotto Electron, non Vitest».

---

## Due macchine

Il progetto si sviluppa su **Fedora x64** e su **macOS arm64**, sempre dalla stessa persona e mai in parallelo. Quello che ne segue:

- **Niente piattaforma cablata negli strumenti.** L'architettura si ricava da `uname -m`, il binario di Electron da `node_modules/electron/path.txt`, che contiene il nome del file dentro `dist/`. Un percorso scritto a mano funziona su una macchina e sull'altra muore con un `No such file or directory` che sembra un'installazione rotta.
- **Il database non viaggia.** `userData` sta in posti diversi su dischi diversi: una lega preparata di qua non si trova di là. Per spostare una sessione serve l'export/import JSON di T18, non una copia di file.
- **Un `pull` non porta `node_modules`.** Tirando giù il lavoro fatto sull'altra macchina, l'albero è aggiornato e le dipendenze sono ferme a prima: mancano esattamente quelle aggiunte nei task nel frattempo. Il sintomo è un comando che non esiste o un import che non risolve, e sembra un'installazione rotta. `npm ci` e poi `electron-builder install-app-deps`.
- **`.claude.local.md` esiste su una macchina sola**, perché è ignorato da git. Se una cosa vale su entrambe va qui, non lì.
- **I limiti sono asimmetrici.** Su Fedora l'AppImage vuole `libfuse2` e il `.deb` vuole `libxcrypt-compat`; su macOS l'app non è firmata e al primo avvio va aperta col tasto destro. Chi documenta un limite dice su quale delle due vale.
- Il `package-lock.json` porta tutte le varianti di piattaforma, quindi cambiare macchina non lo fa oscillare. Se cambia, è per una ragione vera.

---

## Come lavoriamo

Un task per sessione. Alla fine di ogni fase, **produci un pacchetto installabile e provalo**, non aspettare la fine del progetto.

Per leggere cosa mostra davvero l'app: **`/prova-pacchetto`** (`dev` o `pack`) costruisce, lancia e stampa il DOM via DevTools. Le trappole d'avvio sono già dentro lo script: non riscoprirle.

**Strumenti del progetto.** Skill: `/apri-task <n>` apre un task leggendo solo i documenti che indica · `/chiudi-fase` è il rituale opposto, revisione e pacchetto e commit separati · `/muta` rompe le guardie e verifica che i test se ne accorgano · `/prova-servizio` esegue un servizio contro un database vero sotto l'ABI di Electron · `/misura-layout` misura le taglie vere nell'app in esecuzione, invece di calcolarle.

Agenti: `revisore-fase`, `deriva-documenti`, e `revisore-copy` che guarda i soli testi italiani — la categoria che è sfuggita a tre task di fila.

In `.claude/hooks/`, `boundaries` e `typecheck` **bloccano**; `palette`, `copy` e `untracked-guard` **avvisano e basta**. Non è pigrizia: l'ambra sul denaro è corretta e frequente, un titolo minuscolo può essere voluto, e un file non tracciato può essere una nota locale. Una guardia che rifiutasse un caso legittimo verrebbe aggirata dentro un task, ed è il modo in cui una guardia smette di esistere.

**Mentre `revisore-fase` gira, non toccare i file.** Rivede un albero che si muove e deve riverificare da capo ogni citazione: è successo in T11 e in T12, e in entrambi i casi l'ha segnalato lui.

**Prima di chiudere una fase, sempre una review**, con l'agente `revisore-fase`. Che compili e giri non basta: rileggi il lavoro contro le regole di questo file e contro il documento del task, e di' cosa non torna invece di chiudere in silenzio. Ogni rilievo va verificato contro il codice prima di riportarlo: in T1 sette su dieci erano plausibili e falsi. Verificare vuol dire **eseguire**: applicare il DDL a un database di scorta e confrontare i `pragma`, impacchettare un modulo con esbuild per vedere cosa tira dentro davvero.

Se una specifica è ambigua o sbagliata, fermati e chiedi. Non indovinare e non "sistemare" silenziosamente una scelta che sembra strana: quasi tutte le stranezze in questi documenti sono deliberate e motivate.

---

Note di questa macchina, non condivise: @.claude.local.md

