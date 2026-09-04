# Fanta-Help — Documento 5: Roadmap per Claude Code

> Ultimo documento della serie. Accompagna il `CLAUDE.md` da mettere nella radice della repo.

---

## 1. Come usare questa roadmap

**Un task per sessione.** Non incollare cinque task insieme sperando che li faccia tutti: il contesto si degrada e le decisioni tacite si moltiplicano.

**Dai solo i documenti che servono.** Ogni task indica quali. Fornire tutti e cinque ogni volta riempie il contesto di roba irrilevante e peggiora il risultato.

**I documenti stanno in `docs/` nella repo**, così Claude Code li può leggere invece di riceverli incollati. Il `CLAUDE.md` li richiama.

**Un pacchetto installabile alla fine di ogni fase.** Non alla fine del progetto.

### L'ordine e perché

L'infrastruttura rischiosa viene prima di tutto, la logica di dominio prima dell'interfaccia, l'asta prima del contorno.

Il modulo nativo è il punto di rottura più probabile dell'intero progetto. Scoprire che better-sqlite3 non si impacchetta su macOS con metà applicazione già scritta costa dieci volte più che scoprirlo il primo giorno, quando la risposta è ancora "cambiamo approccio".

---

## Fase 0 — Fondamenta rischiose

Nessuna funzionalità. Solo la prova che l'impalcatura regge.

### T1 · Spike di packaging
**Documenti:** 3 (§2, §7)

Scaffolding electron-vite + React + TS. Aggiungere better-sqlite3, aprire una connessione nel main, scrivere e leggere una riga, mostrarla nel renderer via IPC. Nient'altro.

Poi produrre gli installer per Windows, macOS e Linux con electron-builder e **installarli ed eseguirli davvero** su tutti e tre.

**Fatto quando:** i tre pacchetti si installano e la riga letta dal database compare a schermo. Su macOS con tasto destro → Apri, perché non è firmata.

**Attenzione:** `asarUnpack` con `bindings` e `file-uri-to-path`, `externalizeDepsPlugin()`, `postinstall: electron-builder install-app-deps`. Se il rebuild nativo si rivela insostenibile su una piattaforma, fermarsi e valutare `node-sqlite3-wasm` prima di andare avanti.

### T2 · Impalcatura visiva
**Documenti:** 2 (§2), 3 (§2)

Tailwind v4 + shadcn/ui, alias di percorso, `HashRouter`. Definire i token di colore e tipografia del documento 2 come variabili CSS. Una schermata sola con una tabella finta e i token applicati.

**Fatto quando:** la schermata ha lo stesso aspetto in sviluppo e nel pacchetto installato. È il punto in cui i percorsi `file://` di solito rompono gli asset.

---

## Fase 1 — Livello dati

### T3 · Schema e connessione
**Documenti:** 1 (§4, §5)

Schema Drizzle dal DDL del documento 1, migrazioni con drizzle-kit, connessione con i pragma, percorso assoluto per le migrazioni, `drizzle/` in `extraResources`.

**Fatto quando:** le migrazioni girano al primo avvio **nel pacchetto installato**, non solo in sviluppo.

### T4 · Contratto IPC
**Documenti:** 3 (§3)

`shared/contracts.ts` con la mappa canale → schema zod, tipi derivati, `register.ts` nel main con validazione, preload con `invoke` e `subscribe`, wrapper tipizzato nel renderer, involucro `Result<T>`, codici errore con i messaggi italiani.

Bastano due o tre canali reali. La struttura conta più della quantità.

**Fatto quando:** c'è il test che confronta la lista dei contratti con quella degli handler registrati e fallisce se divergono.

---

## Fase 2 — Pipeline dati

Questa fase è uno script separato in `tools/dataset/`, indipendente dall'app. Si può fare in parallelo.

### T5 · Stadio Fantacalcio.it
**Documenti:** 4 (§3, §4, §5)

Parser XLSX per quotazioni e statistiche. Ricerca della riga di intestazione, mappatura per nome di colonna, validazione zod, rifiuto del file intero se troppe righe falliscono. Normalizzazione dei nomi, chiavi `fc-<sourceId>`, riconciliazione tra stagioni, rapporto leggibile, `overrides.json`.

**Fatto quando:** produce un `v1.json.gz` valido da file reali, e **fallisce** se restano ambiguità irrisolte. C'è il test della normalizzazione dei nomi che il documento 6 §7 assegna a questo task: quattro casi, e proteggono tutta la riconciliazione a valle.

**Prima di scrivere il codice:** verificare l'ipotesi che gli `Id` del listone siano stabili tra stagioni, confrontando due listoni consecutivi. Se cade, cambia la strategia di riconciliazione.

### T6 · Stadi facoltativi
**Documenti:** 4 (§2, §3, §5)

Stadio FBref da CSV: minuti, titolarità, presenze, clean sheet, date di nascita. Stadio identificativi esterni per API-Football. Corrispondenza **dentro il club**. Nessuno dei due può far fallire lo stadio 1.

**Fatto quando:** il dataset esce con `hasFbref` e `hasExternalIds` corretti, e le corrispondenze mancanti finiscono nel rapporto senza bloccare.

**Nota, emersa in T14 e decisa dopo.** FBref porta anche il **nome per esteso**, che il listone non ha. Era una delle tre strade di T14b, ed è quella scelta: **questo task e T14b sono lo stesso lavoro** e si aprono insieme. Lo stadio resta «facoltativo» nel senso che non può far fallire lo stadio 1, ma non è più rimandabile — il nome per esteso non esiste da nessun'altra parte offline.

### T7 · Import nell'app
**Documenti:** 4 (§6), 1 (§4, invariante 10)

Manifest, download, verifica sha256, validazione, upsert su `(season_id, source_id)`, marcatura dei delisted, sostituzione delle statistiche, ricostruzione dell'indice FTS5, backup prima dell'import con rotazione a dieci.

**Fatto quando:** un secondo import con un listone diverso non tocca gli acquisti già registrati. Va testato esplicitamente: è l'invariante che si rompe in silenzio.

### T7b · Download del dataset — *rimandato da T7*
**Documenti:** 4 (§6, §8, §9), 3 (§5)

T7 ha fatto tutto l'import tranne la rete: legge il manifest da una **cartella** invece che dall'URL fisso. Quello che manca, e che va fatto tutto insieme perché è un pezzo solo:

- Manifest letto dall'URL fisso di `edocico/fanta-help-dataset`, che è privata.
- Token fine-grained di sola lettura, **iniettato in fase di build** da una variabile d'ambiente e mai nel sorgente: nella repo pubblica dell'app GitHub lo revoca da solo in pochi minuti.
- Download del `.json.gz` con la `fetch` nativa del main. Niente axios.
- **Il percorso del fallimento**, che è metà del task: token che non funziona → l'app lo dice **una volta sola**, passa all'import XLSX e non riprova a ogni avvio.
- Controllo all'avvio senza scaricare (§8): avviso discreto col bottone, e fallimento in silenzio quando manca la rete.
- Togliere l'ingresso `dir` da `dataset.import`. Quel canale prende un percorso del filesystem **solo** per questo buco: è l'unica cosa che oggi permette di indicare un dataset all'app.

Già fatto in T7, da non rifare: verifica `sha256`, confronto fra `latest` e la versione installata, validazione zod, la transazione unica, il backup con rotazione, le invarianti 10 e 17.

**Fatto quando:** un import parte dalla repo privata senza che nessun percorso locale compaia nel codice, e staccando la rete l'app lo dice una volta e resta usabile.

### T8 · Import XLSX in-app
**Documenti:** 4 (§6), 2 (§4.1)

Selettore di file, anteprima delle colonne riconosciute, **conferma della stagione**, creazione della riga `season` se manca, avviso esplicito che le statistiche non vengono aggiornate.

La schermata è l'onboarding dati del documento 2 §4.1, non una vista nuova: due possibilità affiancate senza preferenza suggerita, e l'altra è il download di T7b.

**Fatto quando:** un import XLSX sopra una stagione che ha già lo storico aggiorna prezzi e ruoli e **non tocca** né le statistiche né gli acquisti.

---

## Fase 3 — Consultazione

### T9 · Vista Giocatori
**Documenti:** 2 (§4.4), 1 (§6)

Tabella virtualizzata con TanStack Table + Virtual, filtri come chip, ricerca fuzzy in memoria con uFuzzy, colonne condizionate a `season.has_fbref`, metriche derivate, selettore di stagione solo se ce n'è più di una.

**Fatto quando:** la ricerca risponde mentre digiti senza attesa percepibile su seicento righe.

Quello che il documento 2 §4.4 elenca e T9 **non** ha, perché ha bisogno di una lega: la fascia di colore della squadra che ha comprato e la riga attenuata (T13), la stella degli obiettivi (T12), il prezzo atteso e il punteggio sintetico (T11 per i pesi, T12 per le fasce), il pannello di dettaglio al click (T10). Non sono mostrati vuoti: vale la regola che il §4.4 si dà per le colonne FBref, «le nasconde invece di mostrare quindici trattini».

**Nota:** le etichette di colonna vengono da `src/shared/glossary.ts`, non scritte a mano nella tabella. La mappa è dati puri e può atterrare già qui; il componente `Abbr` che ne mostra l'espansione arriva più avanti, a T23. Farlo in quest'ordine evita di riscrivere le intestazioni due volte.

### T10 · Dettaglio giocatore
**Documenti:** 2 (§4.5)

Pannello laterale con anagrafica, storico in tabella, grafico FM/MV, indicatori derivati ognuno con una riga di spiegazione, blocco obiettivo.

Il blocco obiettivo **non** si costruisce qui: ha bisogno della lega (T11) e degli obiettivi (T12), e vale la regola del §4.4 che T9 applica già a fascia, stella e prezzo atteso — si nasconde invece di mostrarsi vuoto. Arriva a T12.

**Fatto quando:** il pannello si apre col click e si chiude con `Esc`, mostra lo storico completo di chi ce l'ha, e per chi non ha nessuna stagione passata mostra la constatazione del §8 al posto della tabella. Il confine è il numero che il §9 dà: **108 giocatori su 524** sul listone 2026-27, e va verificato contro il dataset, non a occhio — la stagione in corso ha una riga per tutti e 524, quindi una guardia che guardi «una riga qualsiasi» è vera sempre e lo stato vuoto non compare mai.

---

## Fase 4 — Lega

### T11 · Lega e squadre
**Documenti:** 1 (§3, §5), 2 (§4.2, §4.3)

Wizard a tre passi, squadre con colori e ordine, slot per ruolo, controlli di coerenza, transizioni di stato con canali espliciti.

**Attenzione:** il riordino delle squadre va fatto in transazione con indici temporanei negativi. Il vincolo di unicità non si tocca.

### T12 · Obiettivi e piani
**Documenti:** 2 (§4.6, §4.7)

Obiettivi per fascia e ruolo, avviso se la somma dei prezzi massimi di fascia 1 supera il budget. Piani con griglia degli slot e media disponibile per slot rimanente.

**Fatto quando:** dalla stella nasce un obiettivo nella lega attiva, la board lo mostra nella colonna del suo ruolo e lo si trascina fra le fasce; l'avviso sulla fascia 1 compare quando la somma dei prezzi massimi supera il budget; un piano mostra la media disponibile per slot rimanente e la ricalcola a ogni casella riempita.

**Attenzione:** `target.tier` è nullable di proposito — la stella aggiunge in un gesto solo e un gesto solo non può anche chiedere la fascia. La board ha una riga «senza fascia» che è quella, non un cestino.

### T12b · Punteggio sintetico e prezzo atteso — *emerso in T12*
**Documenti:** 1 (§6), 2 (§4.4)

Il documento 1 §6 descrive un punteggio configurabile per lega e un **prezzo atteso** che normalizza quel punteggio sulla distribuzione dei crediti per ruolo. La riga di T9 li attribuisce a «T11 per i pesi, T12 per le fasce», ma nessuna delle due righe li nominava e nessuno dei due task li ha costruiti: `league.scoring_weights` esiste nello schema, è nullo, e non ha ancora nessun lettore.

Serve: i pesi predefiniti differenziati per ruolo, la formula come funzione pura in `shared/domain.ts`, la normalizzazione del prezzo atteso, e le due colonne che il §4.4 elenca e che la vista Giocatori oggi nasconde applicando la propria regola sulle colonne che sarebbero vuote.

Non è un prerequisito dell'asta: T13 non lo legge. Resta da decidere se prima o dopo l'MVP.

---

## Fase 5 — Asta

Il cuore. I servizi prima dell'interfaccia, sempre.

### T13 · Servizi d'asta
**Documenti:** 1 (§5), 3 (§5)

Tutte le invarianti, in transazione, con la severità come parametro per la revisione. Puntata massima con la guardia a zero slot. Undo con cancellazione vera e scrittura nel log. Avanzamento turno solo nel formato draft.

**Fatto quando:** i test coprono le invarianti, e in particolare la puntata massima a rosa quasi completa e la regola di completabilità. **Nessuna interfaccia in questo task.**

### T14 · Interfaccia d'asta
**Documenti:** 2 (§4.8, §5, §6, §7)

Pannello di assegnazione col flusso a tre `Invio`, griglia rose, obiettivi liberi, scorciatoie, toast con annulla, cronologia, avviso infortunio non bloccante.

**Fatto quando:** un acquisto si registra senza toccare il mouse, e il fuoco torna alla ricerca vuota subito dopo.

### T14b · Il nome che si grida non è il nome del listone — *emerso in T14*
**Documenti:** 4 (§3, §4, §5), 2 (§4.8, §7)

**Il fatto.** Il listone nomina **per cognome**, e aggiunge un'abbreviazione del nome solo quando il cognome è ambiguo: nel 2026-27 succede a **89 nomi su 524**, perché ci sono due Martinez, due Thuram, due Pellegrini, due Stankovic. Non sempre è una lettera: dove una non basta il listone ne mette due — `Martinez Jo.`, `Pellegrini Lo.`, `Pessina Mas.` — o due puntate, `Esposito F.P.`, `Ederson D.S.`. Lautaro Martinez è `Martinez L.`. Chi digita «lauta» in asta non trova niente e riceve «Nessun giocatore. Prova con meno lettere.», che è la riga giusta del §7 detta al momento sbagliato: il problema non è che ha scritto troppo, è che ha scritto un nome che il listone non usa.

**Perché conta.** Il §1 mette l'asta al centro — «hai pochi secondi per registrare un acquisto mentre gli altri già chiamano il giocatore dopo» — e questo è l'unico punto in cui la ricerca sbaglia proprio nel momento in cui non c'è tempo. Chi bandisce grida il nome con cui il giocatore è conosciuto, non quello con cui Fantacalcio.it lo elenca.

**Perché non è stato risolto in T14.** Il nome per esteso **non esiste da nessuna parte offline**: `has_fbref` è `0` perché lo stadio facoltativo di T6 non è mai stato eseguito, e `player_external_id` ha una sola riga. Risolverlo dentro il renderer vorrebbe dire indovinare a runtime, che è il divieto del `CLAUDE.md` letto nel suo spirito: l'identità dei nomi si risolve offline e viaggia nel dataset.

**Le tre strade, per non riderivarle.**

1. **Stadio FBref (T6).** Porta il nome per esteso. Il campo va aggiunto in modo **additivo** e il lettore lo tratta come opzionale, quindi `formatVersion` non si alza — §4 del documento 4. La ricerca guarderebbe entrambi i nomi. Risolve anche il caso simmetrico di chi conosce solo il nome di battesimo, e accende le colonne `tit.`, `min` e `CS`.
2. **Sinonimi scritti a mano in `overrides.json`.** Poche voci, costruite offline come gli alias di identità. Poco codice, ma una lista che va tenuta viva ogni stagione e che si scopre vecchia solo fallendo in asta.
3. **Niente.** Il cognome funziona, si impara la prima sera, e 89 nomi su 524 hanno comunque bisogno del cognome per essere distinti.

**Deciso: la prima.** Lo stadio FBref, che il §2 del documento 4 chiamava facoltativo e che qui smette di esserlo. Le altre due sono state scartate per quello che sono: la seconda è una lista che invecchia in silenzio e si scopre vecchia solo fallendo in asta, cioè nel momento che il §1 dice essere l'unico senza tempo; la terza è vera ma risolve il problema dichiarandolo non un problema.

Ne seguono due cose. **T6 e T14b sono un lavoro solo** e vanno aperti insieme. E T6 cambia natura: non è più uno stadio che «non può far fallire lo stadio 1» e basta, è la sola fonte offline del nome per esteso. I CSV di FBref si scaricano a mano, come tutte le fonti: il `CLAUDE.md` non ammette scraper.

Le colonne `tit.`, `min` e `CS` si accendono con lo stesso lavoro: oggi la vista Giocatori le nasconde applicando la propria regola sulle colonne che sarebbero vuote.

**Fatto quando:** digitare il nome con cui il giocatore viene chiamato al tavolo lo trova. Il fissato si prende dal dataset costruito e non a memoria — `lauta` deve trovare `Martinez L.`, che è esattamente il caso da cui questo task è nato.

**Stato: la strada è costruita, il criterio non è ancora soddisfatto.** Il campo `fullName` attraversa pipeline, dataset, database, IPC e ricerca, ed è provato in ogni passaggio — ma i CSV di FBref non sono ancora stati scaricati, quindi nel dataset vero è nullo per tutti e 524 e `lauta` continua a non trovare. Le prove sono state fatte con un export FBref scritto a mano. Chi riapre questo task fa due cose: scarica i dodici file elencati in `tools/dataset/README.md`, rilancia `npm run dataset:build`, e rifà la verifica coi nomi che escono dal rapporto invece che con quelli inventati.

### T15 · Modo proiezione
**Documenti:** 2 (§4.9)

`Ctrl/Cmd+P`. Nasconde assegnazione e obiettivi, ingrandisce la griglia.

---

## Fase 6 — Chiusura

### T16 · Revisione
**Documenti:** 2 (§4.10), 1 (§5, invarianti 11 e 12)

Tabella unica con modifica in linea, aggiunta e cancellazione righe, pannello controlli raggruppato per squadra con **tutte** le anomalie visibili e mai bloccanti.

**Attenzione:** cambiare il giocatore di un acquisto ricalcola `slot_role` nella stessa transazione.

### T17 · Cristallizzazione
**Documenti:** 1 (§7), 2 (§4.11)

Serializzazione canonica, hash, snapshot versionati e non sovrascrivibili, riapertura.

**Fatto quando:** esiste il test che verifica che lo stesso contenuto con chiavi in ordine diverso produca lo stesso hash.

### T18 · Export e import
**Documenti:** 1 (§7), 2 (§4.11)

XLSX leggibile con una scheda per squadra, JSON nel formato dello snapshot, import JSON per riprendere o spostare una sessione.

---

## Fase 7 — Contorno

### T19 · Dati vivi
**Documenti:** 4 (§7), 3 (§5)

Servizio `availability`, client su `fetch` nativo con timeout e retry, aggancio per `player_external_id`, cache in `player_availability`, chiave in `safeStorage`, degradazione completa se manca qualcosa.

**Fatto quando:** togliendo la rete l'app mostra i dati in cache con la loro età e nessun errore.

### T20 · Aggiornamento applicazione
**Documenti:** 3 (§8), 2 (§4.12)

electron-updater su GitHub Releases, i sette stati, download mai automatico, installazione bloccata con asta in corso, stato `manual` su macOS che apre la pagina di download.

### T21 · Impostazioni
**Documenti:** 2 (§4.12), 4 (§7, §9)

Dati, Aggiornamenti, Aspetto, Backup. Chiave API con lo stato della quota residua.

---

## Fase 8 — Refactoring visivo

Dopo l'MVP, non durante. Le viste vanno prima costruite e usate: un design system applicato a schermate che non hanno ancora affrontato dati veri fissa decisioni prese al buio.

### T22 · Token e mappatura
**Documenti:** 7 (§3, §4, §9)

Primitivi e semantici in `:root`, blocco `@theme` con la mappatura shadcn **e con il namespace `--color-*` che genera le utility dell'app**, IBM Plex Sans per interfaccia e colonne, Archivo per titoli e cifre grandi.

**Fatto quando:** l'applicazione ha l'aspetto nuovo ovunque **senza che un solo componente sia stato modificato**. È il passo col miglior rapporto tra risultato e rischio, e va verificato da solo prima di andare avanti. Il criterio regge solo se le utility già in uso (`text-chalk-dim`, `border-line`, `bg-pitch-800`: 71 occorrenze) continuano a risolvere, quindi il §9 va applicato per intero e non solo nella parte shadcn.

### T23 · Primitivi dell'app
**Documenti:** 7 (§10)

`Figure`, `DataTable`, `FilterChip`, `RoleBadge`, `Abbr` — in inglese, come chiede il `CLAUDE.md`, e il §10 del documento 7 è stato allineato.

Con `Abbr` arriva anche il glossario condiviso, e con lui il pannello di riferimento.

**Debito recuperato, da T9 e T10.** Il glossario non esisteva, e i cinque `Intl.NumberFormat` con la funzione `show()` stavano ricopiati in due file — 667 byte per parte, identici byte per byte, coi commenti da una parte sola. Ora stanno in `src/shared/glossary.ts` e in `src/renderer/src/lib/format.ts`.

**Chiuso in T23, e per tre volte la premessa era sbagliata.**

- *«Le sigle sono scritte a mano in due file.»* Sono **otto** file del renderer per le sole sigle di metrica, **dodici** contando le lettere di ruolo e i codici squadra, più `src/shared/domain.ts` e `src/shared/workbook.ts`. Quello che la riga non nominava e conta più di tutti è `Reference.tsx`, che portava già un glossario di quindici voci.
- *«`?` passa da elenco delle scorciatoie a due sezioni.»* Le due sezioni c'erano dal T14. Il lavoro era far leggere la seconda dal glossario condiviso, e aggiungere le sezioni dei ruoli.
- *«La decisione aperta fra chiave-etichetta e chiave-colonna.»* Sciolta a favore dell'**etichetta**, con le prove nel §10 del documento 7: `Qt` non è il nome di nessuna colonna dei quattro listoni, sei voci su diciotto non hanno nessuna colonna su cui chiavare, e il documento 1 §8 aveva già chiuso la domanda gemella con «`matches_rated` internamente, `Pv` nell'interfaccia».

**Fatto quando:** nessun numero dell'applicazione è più scritto a mano dentro un `<span>`, e nessuna sigla compare fuori dal componente. Il tipo `Abbr = keyof typeof glossary` deve impedire che una sigla senza voce nel glossario compili.

### T24 · La board delle rose
**Documenti:** 7 (§3, §10, §11)

**Debito da T22.** I dieci colori squadra. `TEAM_COLORS` in `src/shared/domain.ts` porta ancora le tinte del documento 2 §4.3 — una passeggiata sulla ruota, dal corallo al magenta — mentre il §3 del documento 7 ne dà **dieci diverse**: le prime sei derivate da Okabe-Ito, con un pavimento misurato di ΔE 14,7 sotto protanopia e deuteranopia, e un ordine di assegnazione che fa parte del sistema. Sono due insiemi disgiunti, non due grafie della stessa cosa.

T22 non li ha toccati di proposito: sono un **dato**, salvato in `fanta_team.color` di leghe già giocate, non un token: cambiare la lista lascerebbe le squadre esistenti con colori fuori tavolozza, che il selettore non mostra più come scelte e la cui etichetta cade sull'esadecimale grezzo. Va deciso qui, dove la board esiste e si può guardare — ed è anche dove il §3 manda il proprio debito su `--team-10`, a ΔE 3,8 dal grigio-verde delle etichette.

Due cose da verificare insieme: la guardia di `domain.test.ts` che tiene i colori squadra lontani dai tre esagoni riservati va estesa, perché T22 ha aggiunto `--crimson #D06058` e `--moss #6FB584` ai semantici e nella lista attuale ci sono `#F2564D` corallo e `#5FC46B` prato, che nessun test separa da quelli.

Sostituisce il pannello a righe con una board a colonne: squadre in colonna, slot in riga raggruppati per ruolo. È l'unico cambiamento **strutturale** del refactoring, non solo di aspetto, quindi va isolato dagli altri.

**Debito da T14b.** La proiezione è l'unico schermo dell'asta che **legge chi non ha digitato**, e il nome per esteso non ci arriva: `Ctrl/Cmd+P` smonta il pannello d'asta, che è l'unico posto dove quel nome vive durante l'asta, e in grande resta `Martinez L.` mentre chi bandisce sta gridando «Lautaro». Non è stato fatto in T14b perché il §4.9 non è fra i suoi documenti, e non è stato fatto subito dopo perché questo task riscrive la proiezione da capo: fissare adesso una taglia fra le `--proj-*` vorrebbe dire misurarla due volte. Va deciso qui, e la taglia va misurata nell'app come tutte le altre.

**Fatto quando:** funziona con dieci squadre a rose piene, e la proiezione è la stessa board a scala doppia senza la striscia di assegnazione — non un secondo layout.

**Chiuso in T24, e tre premesse hanno ceduto alla misura.**

- *«Sotto i 1100px la board diventa una lista.»* I 1100 erano una larghezza di **finestra**, e la finestra non è la misura che decide: in asta il pannello di assegnazione ne prende 320 fissi. La soglia vera sta sulla board, è 1000px, ed è misurata sulla curva del troncamento dei 250 cognomi veri. La finestra è passata da 900×620 a 1440×900 con un minimo di 1100, perché a 900 la board non si sarebbe vista mai.
- *«Celle a 44px in proiezione.»* Non stanno su un proiettore 1080p: 25 slot da 44 fanno 1100px di sole celle contro 929,5 disponibili. La cella sale per gradini di altezza e i 44 arrivano dai 1440 in su. Nello stesso paragrafo, «cifre a `--num-xl`» non può valere per dieci intestazioni — dieci cifre da 56px fanno un'intestazione alta 242px — e vale per la sola puntata della squadra di turno, che è la cifra che il documento 2 §2 nomina.
- *«Reparto completo: la lettera del ruolo passa a `--confirmed`.»* Non applicabile: la lettera è condivisa da tutte le colonne e un reparto pieno è di una squadra sola. Il segnale è dentro la colonna.

**I dieci colori.** Sostituiti, e `0003_team_colours.sql` rimappa le leghe esistenti posizione per posizione — il colore non entra nello snapshot né nell'export, quindi nessuna impronta si muove. Il debito su `--team-10` è pagato: `#9AA69F` è diventato `#C67DBD`, cercato su tutto il gamut e non scelto a occhio. La guardia di `domain.test.ts` non è l'uguaglianza che la riga sopra chiedeva di estendere — estenderla non avrebbe protetto da niente, perché nessuna delle due tavolozze contiene un semantico alla lettera — ma due misure: il pavimento ΔE del §3 sulle prime sei sotto deficienza cromatica, e la distanza di ogni tinta dal grigio delle etichette.

**Il nome per esteso in proiezione** è innestato in `CalledPlayer`, e **non è mai stato visto**: `full_name` viene solo da FBref, lo stadio facoltativo di T6 non è mai stato eseguito, e il campo è nullo per tutti e 524. Con `spelledOut` che risponde `null` la fascia rende come prima. Da verificare il giorno che quello stadio gira.

### T25 · Viste e passata finale
**Documenti:** 7 (§4, §10, §14, §15)

**Debito da T22**, due voci che vanno insieme e che nessuna delle due si può fare da sola.

**I titoli di vista.** La riga di T22 chiede «Archivo per titoli» e il §4 li vuole a 24px. T22 ha dichiarato `--font-display` e `--text-heading` ma non li ha applicati: i dieci `<h1>` portano `text-lg`, cioè 18px, e il §15 vieta Archivo sotto i 20. Le due cose sono un cambiamento solo — famiglia **e** taglia — e per farlo da `base.css` servirebbe una regola globale che vince sul `text-lg` dichiarato nel componente, cioè esattamente la regola discendente che il blocco della proiezione argomenta di non scrivere. Si fa qui, vista per vista, che è già il modo di lavorare di questo task.

**La misura base.** Non c'è nessuna `font-size` su `html` né su `body`, quindi tutto ciò che non porta una classe `text-*` rende a **16px** — non ai 14 di shadcn che la lista dei tic del §14 va a cercare, e non ai 13 che il §15 fissa come tetto. La riga da aggiungere a quella lista è «la misura base a 16px», e questo è il task che la esaurisce.

Vista per vista, l'asta per prima. Poi la lista dei tic della sezione 14.

**Debito da T10:** il pannello di dettaglio non ha l'ingresso da destra in 150ms che il documento 2 §2 gli assegna e che il §7 del documento 7 tiene in tabella. È una delle quattro animazioni ammesse, quindi entra qui e non si aggiunge senza toglierne un'altra.

---

## 2. Prompt di apertura

Da usare alla prima sessione, dopo aver messo i documenti in `docs/` e il `CLAUDE.md` nella radice.

> Progetto nuovo: app desktop Electron per l'asta del fantacalcio. Le specifiche complete sono in `docs/`, le convenzioni in `CLAUDE.md`. Leggi il `CLAUDE.md` e il documento 3 sezioni 2 e 7, poi facciamo solo il task T1 della roadmap: lo spike di packaging.
>
> Voglio la prova che better-sqlite3 si impacchetta e funziona su tutti e tre i sistemi prima di scrivere qualsiasi logica. Niente funzionalità, niente interfaccia oltre al minimo.
>
> Se qualcosa nelle specifiche ti sembra ambiguo o sbagliato, fermati e chiedimelo invece di decidere da solo.

L'ultima riga vale la pena ripeterla a ogni task.

---

## 3. Cosa fare quando qualcosa non torna

**Se una specifica sembra sbagliata**, probabilmente lo è: quattro documenti scritti a tavolino non sopravvivono intatti al contatto col codice. Correggila nel documento, non solo nel codice, altrimenti la prossima sessione ripartirà dalla versione vecchia.

**Se una trappola del `CLAUDE.md` si presenta lo stesso**, aggiungi cosa hai scoperto. Quel file è l'unica memoria che attraversa le sessioni.

**Se una fase si allunga troppo**, taglia. Il modo proiezione, i piani multipli e il grafico dello storico sono i primi tre candidati: nessuno dei tre serve per fare un'asta.

---

## 4. Lo stato del progetto

Tutte le decisioni sono chiuse. Nessun punto aperto nei quattro documenti.

L'unica ipotesi che restava da verificare sul campo — la stabilità degli `Id` del listone tra stagioni — è caduta dalla parte buona in T5: su quattro listoni, 0 Id cambiati su 589 nomi confrontabili e 0 riciclati. Lo storico si aggancia per `sourceId`. Si rilancia con `npm run dataset:verify-ids`, e il ragionamento sulla soglia sta in `tools/dataset/README.md`.

| Documento | Contenuto |
|---|---|
| 1 | Scope, modello di dominio, schema SQLite, 17 invarianti, formato snapshot |
| 2 | Direzione visiva, mappa delle viste, flusso d'asta, scorciatoie, casi limite |
| 3 | Struttura repo, contratti IPC, livello dati, sicurezza, build, aggiornamento |
| 4 | Tre fonti, pipeline offline, riconciliazione, import, dati vivi, le due repo |
| 5 | Questo: roadmap dei task |
| 6 | Suite di test. Aggiunto dopo l'avvio dell'implementazione, si innesta da T4 |
| 7 | Design system. Token, componenti, regole. Si applica in refactoring **dopo l'MVP** |
| `CLAUDE.md` | Regole e trappole, nella radice della repo |
| 0 | Revisione, chiusa. Registro di cosa era stato trovato |
