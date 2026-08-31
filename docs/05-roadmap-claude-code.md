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

**Fatto quando:** produce un `v1.json.gz` valido da file reali, e **fallisce** se restano ambiguità irrisolte.

**Prima di scrivere il codice:** verificare l'ipotesi che gli `Id` del listone siano stabili tra stagioni, confrontando due listoni consecutivi. Se cade, cambia la strategia di riconciliazione.

### T6 · Stadi facoltativi
**Documenti:** 4 (§2, §3, §5)

Stadio FBref da CSV: minuti, titolarità, presenze, clean sheet, date di nascita. Stadio identificativi esterni per API-Football. Corrispondenza **dentro il club**. Nessuno dei due può far fallire lo stadio 1.

**Fatto quando:** il dataset esce con `hasFbref` e `hasExternalIds` corretti, e le corrispondenze mancanti finiscono nel rapporto senza bloccare.

### T7 · Import nell'app
**Documenti:** 4 (§6), 1 (§4, invariante 10)

Manifest, download, verifica sha256, validazione, upsert su `(season_id, source_id)`, marcatura dei delisted, sostituzione delle statistiche, ricostruzione dell'indice FTS5, backup prima dell'import con rotazione a dieci.

**Fatto quando:** un secondo import con un listone diverso non tocca gli acquisti già registrati. Va testato esplicitamente: è l'invariante che si rompe in silenzio.

### T8 · Import XLSX in-app
**Documenti:** 4 (§6)

Selettore di file, anteprima delle colonne riconosciute, **conferma della stagione**, creazione della riga `season` se manca, avviso esplicito che le statistiche non vengono aggiornate.

---

## Fase 3 — Consultazione

### T9 · Vista Giocatori
**Documenti:** 2 (§4.4), 1 (§6)

Tabella virtualizzata con TanStack Table + Virtual, filtri come chip, ricerca fuzzy in memoria con uFuzzy, colonne condizionate a `season.has_fbref`, metriche derivate, selettore di stagione solo se ce n'è più di una.

**Fatto quando:** la ricerca risponde mentre digiti senza attesa percepibile su seicento righe.

### T10 · Dettaglio giocatore
**Documenti:** 2 (§4.5)

Pannello laterale con anagrafica, storico in tabella, grafico FM/MV, indicatori derivati ognuno con una riga di spiegazione, blocco obiettivo.

---

## Fase 4 — Lega

### T11 · Lega e squadre
**Documenti:** 1 (§3, §5), 2 (§4.2, §4.3)

Wizard a tre passi, squadre con colori e ordine, slot per ruolo, controlli di coerenza, transizioni di stato con canali espliciti.

**Attenzione:** il riordino delle squadre va fatto in transazione con indici temporanei negativi. Il vincolo di unicità non si tocca.

### T12 · Obiettivi e piani
**Documenti:** 2 (§4.6, §4.7)

Obiettivi per fascia e ruolo, avviso se la somma dei prezzi massimi di fascia 1 supera il budget. Piani con griglia degli slot e media disponibile per slot rimanente.

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

L'unica ipotesi non ancora verificata sul campo è la stabilità degli `Id` del listone tra stagioni, e va controllata prima del task T5.

| Documento | Contenuto |
|---|---|
| 1 | Scope, modello di dominio, schema SQLite, 17 invarianti, formato snapshot |
| 2 | Direzione visiva, mappa delle viste, flusso d'asta, scorciatoie, casi limite |
| 3 | Struttura repo, contratti IPC, livello dati, sicurezza, build, aggiornamento |
| 4 | Tre fonti, pipeline offline, riconciliazione, import, dati vivi, le due repo |
| 5 | Questo: roadmap dei task |
| `CLAUDE.md` | Regole e trappole, nella radice della repo |
| 0 | Revisione, chiusa. Registro di cosa era stato trovato |
