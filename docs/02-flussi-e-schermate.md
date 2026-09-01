# Fanta-Help — Documento 2: Flussi e schermate

> Input: documento 1 (scope e modello dati).
> Output: base per il documento 3 (architettura e contratti IPC).

---

## 1. Principi di interfaccia

Cinque regole che decidono ogni dubbio successivo.

**L'asta è il vincolo, tutto il resto è comodità.** Durante l'asta hai pochi secondi per registrare un acquisto mentre gli altri già chiamano il giocatore dopo. Ogni scelta di interfaccia che rallenta l'inserimento è sbagliata, anche se rende l'app più bella altrove.

**Niente modali durante l'asta.** Un dialog che ruba il focus costa due secondi e un errore. Conferme inline, avvisi come toast, correzione con undo.

**Annullare invece di confermare.** Le azioni si eseguono subito e restano annullabili per dieci secondi. Chiedere "sei sicuro?" venti volte a sera è peggio che sbagliare due volte.

**I numeri sono il contenuto.** Crediti residui, puntata massima, slot mancanti. Vanno letti da un metro di distanza, di sera, mentre qualcuno urla un rilancio.

**L'app non arbitra.** Non decide chi ha vinto il rilancio e non gestisce il timer. Registra quello che è successo nella stanza. Questo taglia via metà della complessità e tutta la sincronizzazione.

---

## 2. Direzione visiva

### Il soggetto

Un'asta di fantacalcio è una sera di fine agosto in un salotto o in un bar, dieci persone, un listone stampato pieno di segni a penna, e un tabellone che tutti guardano per sapere quanto gli è rimasto. L'app sostituisce il foglio Excel condiviso e il quaderno del banditore.

Da qui la direzione: **un pannello di regia, non un'applicazione gestionale**. Superficie scura perché si usa la sera per tre ore di fila, tipografia da tabellone, densità da foglio di calcolo.

### Palette

Base verde-nera, il campo di notte. I colori delle squadre partecipanti sono l'unica altra fonte di colore, e sono informazione: la stessa squadra ha lo stesso colore nella griglia rose, nel registro acquisti e nei filtri.

```css
--pitch-900:  #0E1512;   /* sfondo applicazione */
--pitch-800:  #161F1A;   /* pannelli */
--pitch-700:  #1F2C25;   /* superfici elevate, righe alternate */
--line:       #2B3A32;   /* bordi hairline */
--chalk:      #E9EFE9;   /* testo primario */
--chalk-dim:  #8B9C92;   /* testo secondario, etichette */
--credit:     #E8B33D;   /* crediti, prezzi, puntata massima */
--taken:      #A8483E;   /* giocatore non più disponibile */
--target:     #4FB8A8;   /* è nella tua lista obiettivi */
```

Il tema chiaro esiste ed è la stessa struttura con i valori invertiti, ma il default è scuro.

L'ambra è riservata al denaro. Se un numero è ambra è un credito. Nient'altro usa quel colore, mai per decorazione.

### Tipografia

Una sola famiglia, **Archivo** (variabile, asse di larghezza), su tre ruoli distinti:

| Ruolo | Trattamento | Dove |
|---|---|---|
| Cifre | Archivo Expanded 600, cifre tabulari | crediti, prezzi, puntata massima |
| Interfaccia | Archivo 400/500 | tabelle, form, navigazione |
| Etichette | Archivo 500, `letter-spacing: 0` | intestazioni colonna, campi |

**Intestazioni di colonna e valori in minuscolo, titoli di vista e di sezione in sentence case.** Gli acronimi tengono le maiuscole: `FVM`, `MV`, `FM`. Mai maiuscolo spaziato: su ogni intestazione è il tic più riconoscibile delle interfacce generate, e su una tabella con quindici colonne rende anche più lenta la lettura.

Gli schemi ASCII più avanti in questo documento sono bozzetti di impaginazione, non copy letterale: dove scrivono `Giocatore` in un'intestazione di colonna vale la regola qui sopra.

Le cifre tabulari sono obbligatorie ovunque compaia un numero in colonna: `font-variant-numeric: tabular-nums`. Senza, le colonne dei crediti ballano a ogni aggiornamento.

### Densità e struttura

Questa app sostituisce un foglio di calcolo, quindi assomiglia a un foglio di calcolo curato, non a una dashboard di card.

- Righe tabella a 36px, comode da colpire col mouse ma dense abbastanza da vederne trenta insieme.
- Separatori a un pixel di `--line`, niente ombre.
- Raggio 4px sui controlli, 0 sulle righe di tabella.
- Nessuna card contenitore attorno a contenuto che è già una tabella.

### Movimento

Solo in risposta a un'azione, e solo per mostrare cosa è cambiato:

- La riga di un acquisto appena registrato lampeggia una volta nel colore della squadra, 400ms.
- Il numero dei crediti conta da vecchio a nuovo valore in 200ms, così l'occhio vede che si è mosso.
- Il pannello di dettaglio giocatore entra da destra in 150ms.

Nient'altro si anima. `prefers-reduced-motion` disattiva tutto tranne il cambio di colore.

### L'elemento firma

La **puntata massima** della squadra di turno. Ambra, Archivo Expanded, la cifra più grande sullo schermo dopo il nome del giocatore in asta. È il numero che serve davvero mentre si rilancia e che nessun foglio Excel calcola da solo.

Tutto il resto attorno resta silenzioso.

---

## 3. Mappa delle viste

```
Avvio
 └─ Onboarding dati ──► Home

Home (elenco leghe)
 ├─ Nuova lega ──► Wizard (3 passi) ──► Lega
 └─ Apri lega ─────────────────────────► Lega

Giocatori                     ← accessibile sempre, indipendente dalla lega
 └─ Dettaglio giocatore (pannello laterale)

Lega
 ├─ Squadre           (partecipanti, ordine, colori)
 ├─ Obiettivi         (target per fascia)
 ├─ Piani             (rose simulate)
 ├─ Asta              (schermo intero)
 ├─ Revisione         (a asta finita: correzione libera, poi cristallizzazione)
 └─ Resoconto         (a lega cristallizzata: sola lettura, export)

Impostazioni
 ├─ Dati              (versione listone, aggiorna, importa XLSX)
 ├─ Aggiornamenti     (versione app, controlla, scarica, installa)
 ├─ Aspetto           (tema)
 └─ Backup            (esporta/importa tutto)
```

Navigazione: barra laterale stretta a sinistra con le sezioni della lega attiva, selettore lega in alto. Durante l'asta la barra si ritrae e la vista occupa tutto.

---

## 4. Le schermate

### 4.1 Onboarding dati

Compare solo al primo avvio, o quando il database non ha nessuna stagione.

Una schermata, due possibilità, nessuna preferenza suggerita:

- **Scarica il listone 2026/27** — prende il dataset dalla repo, mostra una barra di avanzamento con il numero di giocatori importati, poi passa alla home.
- **Importa un file** — selettore di file XLSX, anteprima delle colonne riconosciute prima di confermare, poi importa.

Se il download fallisce l'errore dice cosa fare, non si scusa: "Non riesco a raggiungere la repo del listone. Controlla la connessione oppure importa il file XLSX scaricato da Fantacalcio.it."

### 4.2 Home

Elenco delle leghe come righe, non card. Per ognuna: nome, stagione, modalità, numero di squadre, stato, e una barra di avanzamento degli slot assegnati se l'asta è in corso.

Stato vuoto: "Nessuna lega. Creane una per iniziare a preparare l'asta." e il bottone.

### 4.3 Wizard di creazione lega

Tre passi, con possibilità di tornare indietro e un riepilogo finale.

**Passo 1 — Regolamento.** Nome, stagione, modalità (Classic/Mantra), formato asta (a chiamata / draft a turni), budget, puntata minima.

**Passo 2 — Squadre.** Righe aggiungibili: nome squadra, allenatore, colore (da una palette predefinita di dieci tinte distinguibili), checkbox "questa è la mia". Ordine trascinabile, definisce il turno. Minimo due squadre.

**Passo 3 — Rosa.** Slot per ruolo, precompilati a 3/8/8/6. Sotto, un controllo di coerenza in tempo reale: `squadre × slot totali` contro i giocatori disponibili per ruolo, e `budget` contro `slot × puntata minima`. Se qualcosa non torna lo dice subito, senza bloccare.

Al termine la lega entra in stato `pre_auction`.

### 4.4 Giocatori

La vista di consultazione, il cuore della fase pre-asta.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ 🔍 Cerca un giocatore                                     643 giocatori        │
│ [P][D][C][A]  [Squadra ▾] [Ruolo Mantra ▾] [Qt. ▾] [FM ▾]  ○ rigoristi ○ preso│
├────┬──────────────────┬─────┬───────┬─────┬─────┬──────┬─────┬─────┬─────┬────┤
│    │ Giocatore        │ Ruo │ Squa  │ Qt. │ FVM │  FM  │ MV  │ Pr. │ Bon │ ★  │
├────┼──────────────────┼─────┼───────┼─────┼─────┼──────┼─────┼─────┼─────┼────┤
│    │ Lautaro Martinez │ A   │ INT   │  32 │ 145 │ 9,12 │6,41 │  34 │+2,7 │ ★  │
│    │ Dimarco          │ D   │ INT   │  18 │  72 │ 7,84 │6,18 │  31 │+1,7 │ ☆  │
│ ▓  │ Thuram           │ A   │ INT   │  29 │ 130 │ 8,90 │6,35 │  29 │+2,6 │ ★  │
└────┴──────────────────┴─────┴───────┴─────┴─────┴──────┴─────┴─────┴─────┴────┘
```

**Quale stagione mostra.** Quando c'è una lega aperta, la sua. Altrimenti la più recente importata. Un selettore di stagione compare solo se nel database ce n'è più di una, perché un menu con una voce sola è rumore.

**Colonne condizionate alla fonte.** Titolarità, minuti e clean sheet esistono solo se lo stadio FBref è stato eseguito. La tabella le nasconde leggendo `season.has_fbref`, invece di mostrare quindici trattini. Stessa regola per la colonna infortuni, che dipende dallo strato dei dati vivi.

**Il filtro dei titolari è un numero, non un interruttore.** "Solo titolari" nasconde una soglia arbitraria decisa da qualcun altro. Meglio un filtro **Pv minime** con un valore digitabile, e un chip preimpostato a 25 su 38 giornate per chi non vuole pensarci. La soglia resta visibile e modificabile.

- La colonna a sinistra è la fascia di colore della squadra che lo ha comprato, se una lega è aperta e il giocatore è già stato preso. Riga attenuata.
- Un giocatore infortunato o squalificato porta un contrassegno accanto al nome, con il rientro previsto nel tooltip.
- Ruoli Mantra come badge secondari sotto il nome, non in colonna propria: occuperebbero troppo spazio orizzontale.
- Ogni colonna è ordinabile. L'ordinamento predefinito è per quotazione decrescente dentro il ruolo filtrato.
- Filtri come chip attivabili, non menu annidati. Restano visibili quelli attivi, con una x per toglierli.
- Click sulla riga apre il pannello di dettaglio a destra, senza lasciare la lista.
- La stella aggiunge agli obiettivi della lega attiva, con rating impostabile al passaggio del mouse.

La tabella è virtualizzata. La ricerca filtra mentre digiti, senza pulsante e senza attesa.

### 4.5 Dettaglio giocatore

Pannello laterale, 420px, si chiude con Esc.

Anagrafica e quotazioni in alto. Sotto, lo storico stagione per stagione in tabella compatta, e un grafico a linee di FM e MV sulle stagioni disponibili. Poi gli indicatori derivati del documento 1, ognuno con una riga di spiegazione in linguaggio piano, perché "bonus index +2,7" non dice niente da solo.

In fondo, il blocco obiettivo: fascia, prezzo massimo, rating, note. Si compila da qui senza aprire altro.

### 4.6 Obiettivi

Colonne per ruolo, righe per fascia. Ogni giocatore è una tessera compatta con nome, squadra, prezzo massimo e rating. Trascinabile tra fasce.

In alto, per ogni ruolo: quanti obiettivi hai, la somma dei prezzi massimi e quanto pesa sul budget. Se la somma dei prezzi massimi dei tuoi obiettivi di fascia 1 supera il budget, l'app lo dice, perché è esattamente l'errore che si fa preparando l'asta.

### 4.7 Piani

Griglia degli slot della rosa, uno per casella, divisi per ruolo. Le caselle vuote sono cliccabili e aprono la ricerca filtrata sul ruolo giusto.

Barra in alto: speso, residuo, e **media disponibile per slot rimanente**, che è il numero che dice se il piano regge.

Due piani si possono affiancare per confronto.

### 4.8 Asta live

Schermo intero, tre zone.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Lega degli Amici · Classic · a chiamata      Turno: Real Fanta   142/200       │
├──────────────────────────────┬────────────────────────────────────────────────┤
│ ASSEGNA                      │ ROSE                                           │
│                              │                                                │
│  🔍 lauta                    │  ▌Real Fanta            218 cr   max 205       │
│  ─────────────────────────   │   P ●●○   D ●●●●●●○○   C ●●●○○○○○   A ●●○○○○  │
│  Lautaro Martinez  A INT 32  │                                                │
│  Lautaro Rojas     C TOR  5  │  ▌Bomber Team            96 cr   max  84       │
│                              │   P ●●●   D ●●●●○○○○   C ●●●●●●○○   A ●●●○○○  │
│  Prezzo    [   47 ]          │                                                │
│  Squadra   [ Real Fanta  ▾]  │  ▌Zona Cesarini          31 cr   max  19       │
│                              │   P ●●○   D ●●●●●●●○   C ●●●●●●●●   A ●●●●○○  │
│  ┌────────────────────────┐  │                                                │
│  │      Assegna    ⏎      │  │  ▌…                                            │
│  └────────────────────────┘  │                                                │
├──────────────────────────────┤                                                │
│ OBIETTIVI ANCORA LIBERI      │                                                │
│ ★★★★★ Thuram    A   max 60   │                                                │
│ ★★★★☆ Dimarco   D   max 38   │                                                │
│ ★★★☆☆ Frattesi  C   max 22   │                                                │
└──────────────────────────────┴────────────────────────────────────────────────┘
```

**Zona di assegnazione (sinistra).** Il campo di ricerca è sempre a fuoco quando la vista si apre e dopo ogni assegnazione. Sotto, i risultati con ruolo, squadra e quotazione. Sotto ancora, prezzo e squadra acquirente.

Se il giocatore selezionato risulta indisponibile, **il pannello lo dice lì**, prima del campo prezzo: `Infortunato · rientro previsto a novembre · dato di 2 giorni fa`. È l'unico momento in cui quell'informazione conta davvero, e nessun foglio Excel te la mette davanti mentre stai per pagare.

L'avviso **non blocca**. Ci sono ragioni legittime per comprare un infortunato a prezzo scontato, e l'app non è lì per discutere le tue scelte.

**Griglia rose (destra).** Una riga per squadra. Il colore della squadra è la barra verticale a sinistra. Pallini pieni per slot occupati, vuoti per liberi. Crediti residui e puntata massima in ambra. La squadra di turno ha lo sfondo leggermente più chiaro. La tua ha il nome in grassetto.

Cliccare una squadra espande la sua rosa completa sotto la riga, con i nomi e i prezzi pagati.

**Obiettivi liberi (in basso a sinistra).** I tuoi target ancora non assegnati, ordinati per fascia e rating. Quando qualcuno te ne compra uno sparisce dall'elenco con un lampeggio rosso. Serve a sapere in tempo reale quanto del tuo piano è ancora in piedi.

### 4.9 Modo proiezione

Variante opzionale della schermata d'asta, per quando c'è un secondo schermo o un televisore. Nasconde la zona di assegnazione e i tuoi obiettivi, ingrandisce la griglia rose e mostra in grande il giocatore attualmente chiamato. Serve al tavolo, non a te.

Attivabile da un pulsante nella barra superiore o con `Ctrl/Cmd+P`. Non `F11`, che su tutti e tre i sistemi è già lo schermo intero.

### 4.10 Revisione

Si arriva qui premendo "Chiudi l'asta". È la fase in cui si aggiusta tutto quello che è andato storto nelle tre ore precedenti, e va progettata con la logica opposta a quella dell'asta: lì contava la velocità, qui conta poter mettere le mani ovunque.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Lega degli Amici · revisione                    198 acquisti  ·  4 anomalie   │
├───────────────────────────────────────────────────┬───────────────────────────┤
│ [Tutte le squadre ▾]  [Tutti i ruoli ▾]  🔍       │ CONTROLLI                 │
├───┬────────────────────┬─────┬──────────────┬─────┤                           │
│ # │ Giocatore          │ Ruo │ Squadra      │ Pr. │ ▾ Real Fanta          2   │
├───┼────────────────────┼─────┼──────────────┼─────┤   9 difensori su 8        │
│ 1 │ Lautaro Martinez   │ A   │ Real Fanta ▾ │ 47  │   1 portiere mancante     │
│ 2 │ Dimarco            │ D   │ Bomber Team ▾│ 31  │                           │
│ 3 │ Thuram             │ A   │ Real Fanta ▾ │ 52  │ ▾ Bomber Team         1   │
│ … │                    │     │              │     │   sforato di 4 crediti    │
├───┴────────────────────┴─────┴──────────────┴─────┤                           │
│ + Aggiungi un acquisto                            │ ▾ Zona Cesarini       1   │
├───────────────────────────────────────────────────┤   1 attaccante mancante   │
│              [ Cristallizza il resoconto ]        │                           │
└───────────────────────────────────────────────────┴───────────────────────────┘
```

**Tabella unica di tutti gli acquisti.** Prezzo e squadra modificabili in linea: click sulla cella, digiti, Tab. Il giocatore si sostituisce aprendo la ricerca dalla cella. Ogni riga ha un menu per eliminarla.

**Aggiungi un acquisto** in fondo, per le righe dimenticate durante l'asta. Stesso flusso di inserimento della schermata d'asta, senza fretta.

**Pannello controlli a destra.** Le anomalie sono raggruppate per squadra, con il conteggio accanto al nome. **Tutte vengono mostrate**: niente "e altre 12", niente troncamento, niente riassunto. Un gruppo si può richiudere quando l'hai sistemato, ma nessuna riga sparisce d'ufficio. Ogni anomalia è cliccabile e porta alla riga interessata, filtrando la tabella su quella squadra.

Le anomalie **non bloccano**: mentre sposti un giocatore da una squadra all'altra la seconda è per forza sforata per un istante.

**Cristallizza il resoconto.** Se ci sono anomalie il bottone chiede conferma elencandole, ma non le impone. Chi gioca sa se una rosa da 24 è un errore o un accordo tra amici.

Cristallizzare produce lo snapshot, porta la lega in `closed` e apre il resoconto.

### 4.11 Resoconto

La lega cristallizzata, in sola lettura.

In cima, una barra che dice quale versione stai guardando: `Versione 1 · 5 settembre, 23:41 · a91f4c2 · firmato da PC di Edoardo`. Se ci sono più versioni si passa dall'una all'altra da un selettore.

Il confronto tra due versioni non entra nella v1. Con un solo autore le versioni si susseguono, non si contraddicono, e l'elenco con data e impronta basta a capire quale sia l'ultima. Il confronto diventa utile quando arriveranno le versioni degli altri partecipanti, ed è per quel momento che il formato dello snapshot è già predisposto.

Sotto: rose finali complete di prezzi, spesa per reparto per squadra, e i numeri che alla fine si guardano sempre. Giocatore più pagato, chi ha speso di più per l'attacco, chi ha chiuso con più crediti in mano.

Due bottoni di export, **Scarica XLSX** e **Scarica JSON**, e uno secondario, **Riapri per modifiche**, che riporta in revisione avvisando che la prossima cristallizzazione creerà la versione successiva.

Il XLSX è per gli amici, il JSON è per l'app. Il primo è un foglio leggibile con una scheda per squadra e una riepilogativa; il secondo è il formato della sezione 7 del documento 1, quello che un domani servirà a confrontare versioni diverse.

### 4.12 Aggiornamenti

Due cose si aggiornano e vanno tenute distinte nell'interfaccia, perché rispondono a bisogni diversi: **il listone** cambia tre volte a settembre, **l'applicazione** cambia quando ci lavori sopra.

**Impostazioni → Dati.** Versione del listone installata, data, numero di giocatori. Se ce n'è una più recente compare la nota del manifest, che dice a cosa serve: "Aggiornamento dopo la chiusura del mercato" è un'informazione, "v4 disponibile" non lo è. Sotto, il bottone per importare un XLSX.

**Impostazioni → Aggiornamenti.** Versione dell'app, e lo stato del controllo:

| Stato | Cosa si vede |
|---|---|
| Nessun aggiornamento | "Fanta Help 1.2.0 è l'ultima versione." e un bottone per ricontrollare |
| Disponibile | Numero di versione, note della release, **Scarica** |
| In scaricamento | Barra di avanzamento con la percentuale |
| Pronto | "La versione 1.3.0 è pronta." e **Riavvia e installa** |
| Solo macOS non firmato | "La versione 1.3.0 è disponibile." e **Apri la pagina di download** |
| Errore | Cosa è andato storto e il bottone per riprovare |

Il controllo parte da solo all'avvio, con qualche secondo di ritardo per non rallentare l'apertura. **Il download non parte mai da solo.** Scaricare centoventi megabyte senza chiedere, magari mentre qualcuno prepara l'asta col telefono in tethering, non si fa.

Quando c'è un aggiornamento pronto, nella barra laterale compare un pallino accanto a Impostazioni. Nient'altro: niente banner in cima, niente finestra che si apre da sola, niente puntino rosso lampeggiante. Un'app che ti interrompe per dirti che esiste una versione nuova è un'app che ti interrompe.

---

## 5. Il flusso di assegnazione

È l'unica interazione che va progettata al tasto. Tutto il resto può essere approssimativo, questa no.

### Sequenza

1. Il fuoco è già nel campo di ricerca.
2. Digiti due o tre lettere. I risultati appaiono sotto, il primo è preselezionato.
3. `↓` `↑` per cambiare selezione, `Invio` per scegliere. Il fuoco passa al prezzo.
4. Digiti il prezzo. `Invio`.
5. Il fuoco passa alla squadra, già precompilata con quella di turno. Se va bene, `Invio`. Altrimenti digiti le prime lettere o premi il numero della squadra.
6. `Invio` conferma. L'acquisto è registrato, il fuoco torna alla ricerca, il campo è vuoto.

Tre `Invio` e il nome del giocatore. Nel caso migliore, quando la squadra di turno è quella giusta e il prezzo è corto, sono circa dieci tasti.

### Dopo la conferma

- La riga della squadra nella griglia lampeggia una volta.
- I crediti contano al nuovo valore.
- Compare un toast in basso: "Lautaro Martinez → Real Fanta, 47 crediti" con **Annulla**, che resta dieci secondi.
- Se il formato è draft a turni, il turno avanza da solo.

### Correzione

`Ctrl/Cmd+Z` annulla l'ultimo acquisto in qualsiasi momento, anche a toast scaduto. Per correggere un acquisto più vecchio si apre la cronologia (`Ctrl/Cmd+H`), si trova la riga e si modifica o si elimina. Modificare un acquisto vecchio chiede conferma, perché lì l'errore è meno probabile dell'errore nel correggerlo.

---

## 6. Scorciatoie da tastiera

| Tasto | Azione | Dove |
|---|---|---|
| `Ctrl/Cmd+K` | Vai alla ricerca | ovunque |
| `/` | Vai alla ricerca | fuori dai campi di testo |
| `↑` `↓` | Naviga i risultati | ricerca |
| `Invio` | Conferma il passo corrente | assegnazione |
| `Esc` | Svuota e ricomincia l'inserimento | asta |
| `Tab` `Shift+Tab` | Campo successivo o precedente | assegnazione |
| `1`–`9` | Scegli la squadra n-esima | campo squadra |
| `Ctrl/Cmd+Z` | Annulla l'ultimo acquisto | asta |
| `Ctrl/Cmd+H` | Cronologia operazioni | asta |
| `Ctrl/Cmd+F` | Apri i filtri | giocatori |
| `Spazio` | Espandi la rosa della squadra selezionata | griglia rose |
| `Ctrl/Cmd+P` | Modo proiezione | asta |
| `?` | Riferimento: scorciatoie e sigle | ovunque |

`?` apre un pannello a due sezioni: tutte le scorciatoie, e tutte le sigle dell'interfaccia con il significato per esteso. Le scorciatoie servono una volta sola, la prima sera, ma quella sera servono. Le sigle servono a chiunque non conosca a memoria la differenza tra `Pv` e `MV`, che è quasi tutti.

---

## 7. Casi limite

Ogni riga è un comportamento da implementare, non un suggerimento.

| Situazione | Comportamento | Messaggio |
|---|---|---|
| Giocatore già acquistato | Appare nei risultati ma non selezionabile, riga attenuata | "Già a Bomber Team per 34" |
| Slot del ruolo pieno | Assegnazione bloccata | "Real Fanta ha già 8 difensori" |
| Prezzo oltre i crediti residui | Bloccata | "Real Fanta ha 218 crediti" |
| Prezzo oltre la puntata massima | Bloccata | "Real Fanta può arrivare a 205: deve tenere 13 crediti per gli slot rimasti" |
| Prezzo sotto la puntata minima | Bloccata | "La puntata minima è 1" |
| Rosa completa | La squadra sparisce dal selettore | "Zona Cesarini ha completato la rosa" |
| Chiudi asta con rose incomplete | Permesso, con avviso | "3 squadre hanno slot liberi. Chiudere lo stesso?" |
| Import listone con asta in corso, in revisione o chiusa | Bloccato | "Non puoi aggiornare il listone con un'asta aperta o in revisione." |
| Giocatore infortunato in asta | Segnalato, mai bloccante | "Infortunato · rientro previsto a novembre · dato di 2 giorni fa" |
| Dati infortuni non disponibili | Colonna e avviso assenti, nessun errore | nessuno |
| Chiave API assente o rifiutata | Detto una volta nelle impostazioni | "La chiave non è valida. Gli infortuni restano nascosti." |
| Token del dataset non valido | Detto una volta, poi silenzio | "Non riesco a raggiungere la repo del listone. Puoi importare il file XLSX." |
| Giocatore sparito dal nuovo listone ma già acquistato | Resta in rosa, marcato | "Non è più nel listone del 5 settembre" |
| App chiusa a metà asta | Riapre allo stato esatto | nessuno |
| Ricerca senza risultati | Riga singola | "Nessun giocatore. Prova con meno lettere." |
| Anomalia in revisione | Segnalata, mai bloccante | "Bomber Team ha sforato di 4 crediti" |
| Cristallizzazione con anomalie | Permessa, con conferma che le elenca | "3 anomalie non risolte. Cristallizzare comunque?" |
| Modifica su lega cristallizzata | Bloccata, con la via d'uscita | "Il resoconto è cristallizzato. Riaprilo per modificarlo." |
| Riapertura di un resoconto | Permessa, con avviso | "La prossima cristallizzazione creerà la versione 2. La versione 1 resta consultabile." |
| Modifica del regolamento a asta avviata | Bloccata | "Il regolamento si blocca quando parte l'asta." |
| Installazione aggiornamento con asta in corso | Bloccata | "Installare richiede il riavvio. Chiudi l'asta prima di aggiornare." |
| Controllo aggiornamenti senza rete | Silenzioso all'avvio, esplicito se richiesto a mano | "Non riesco a controllare gli aggiornamenti." |

Sull'ultima riga della tabella vale la pena essere espliciti: ogni acquisto è una transazione singola committata subito. Non esiste uno stato "in corso" da perdere, quindi non serve nessun salvataggio automatico e nessun recupero sessione.

---

## 8. Stati vuoti

Un'app usata una sera all'anno passa molto tempo vuota. Ogni schermata vuota dice cosa fare, in una riga, con l'azione accanto.

| Vista | Testo |
|---|---|
| Home | "Nessuna lega. Creane una per iniziare a preparare l'asta." |
| Obiettivi | "Nessun obiettivo. Aggiungi giocatori dalla scheda Giocatori con la stella." |
| Piani | "Nessun piano. Costruisci una rosa ipotetica per capire quanto ti serve per reparto." |
| Squadre | "Aggiungi le squadre che partecipano all'asta." |
| Cronologia | "Nessuna operazione ancora." |

Una sola eccezione, ed è deliberata: lo **storico assente** di un giocatore. Lì non c'è nessuna azione da proporre, perché non ha giocato, e un invito inventato sarebbe peggio del silenzio. Quella riga constata: *"Nessuna presenza nelle stagioni disponibili (2023-24 → 2025-26)."* La finestra si nomina, e le stagioni si leggono da quelle presenti in `player_season_stat` invece di essere scritte a mano. Non si dice "esordiente": sarebbe spesso falso, perché molti di quei giocatori arrivano dall'estero o dalla Serie B.

---

## 9. Decisioni prese

- **Il modo proiezione entra nella v1.**
- **Il turno nell'asta a chiamata si mostra ma non avanza da solo.** C'è una freccia per farlo avanzare a mano. Nel draft a turni avanza automaticamente dopo ogni assegnazione.
- **Il grafico nello storico giocatore entra nella v1.**
- **Il confronto tra versioni del resoconto non entra nella v1.** Solo l'elenco con data e impronta.
- **Il regolamento si blocca all'avvio dell'asta.** Budget, slot, puntata minima e formato si modificano in `setup` e `pre_auction`, poi diventano di sola lettura fino alla fine. Le regole si concordano prima di iniziare, quindi non serve poterle cambiare a metà, e togliere quella possibilità elimina una categoria intera di stati incoerenti.
- **Le anomalie in revisione si raggruppano per squadra e si mostrano tutte.**
- **Il filtro dei titolari è un valore numerico di Pv minime**, con un chip preimpostato a 25, non un interruttore con una soglia nascosta.
- **La vista Giocatori mostra la stagione della lega aperta**, o la più recente importata. Il selettore compare solo con più di una stagione presente.
- **Le colonne che dipendono da FBref e dai dati vivi si nascondono quando la fonte manca**, invece di mostrarsi vuote.
- **Lo storico si nasconde solo quando non c'è, mai perché è poco.** Un giocatore senza nessuna riga nelle stagioni disponibili mostra una constatazione al posto della tabella. Chi ha giocato poco mostra quello che ha, con `Pv` accanto a qualificarlo: `6,80 su 4 Pv` nessuno lo confonde con `6,80 su 34 Pv`. Una soglia di "precedenti sufficienti" sarebbe la stessa soglia nascosta che il filtro dei titolari ha già rifiutato, e quattro partite a 7,5 sono il ragazzo esploso a maggio — un'informazione, non rumore. È diverso dal caso qui sopra: lì manca la **fonte** e la colonna è vuota per tutti, qui il valore esiste e riposa su poco. Sul listone 2026-27 il caso davvero vuoto riguarda 108 giocatori su 524.
- **Il modo proiezione passa da `F11` a `Ctrl/Cmd+P`**, perché `F11` è già lo schermo intero di sistema.
- **L'infortunio compare nel pannello di assegnazione**, non solo nella tabella, e non blocca mai l'acquisto.

---

## Prossimo passo

Documento 3: architettura. Struttura delle cartelle, contratti IPC tipizzati tra main e renderer, dove vive lo stato, configurazione di build e packaging.
