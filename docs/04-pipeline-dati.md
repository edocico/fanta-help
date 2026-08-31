# Fanta-Help — Documento 4: Pipeline dati

> Revisione 2. Reintroduce FBref come stadio facoltativo e aggiunge lo strato dei dati vivi.

---

## 1. Tre fonti, tre velocità

Il criterio che governa tutto il documento non è la fonte, è **la velocità con cui il dato cambia**.

| Velocità | Dati | Come arrivano |
|---|---|---|
| Una volta a stagione, con qualche ritocco a settembre | anagrafica, ruoli, quotazioni, FVM | file XLSX di Fantacalcio.it, pipeline offline |
| Ferme per sempre una volta chiusa la stagione | statistiche storiche | XLSX di Fantacalcio.it + CSV di FBref, pipeline offline |
| Ogni giorno | infortuni e squalifiche | API-Football, chiamata a runtime, in cache |

Andare online a runtime per i primi due non aggiunge niente e aggiunge fragilità. Congelare il terzo in un dataset generato tre settimane prima lo rende inutile.

### Cosa dà ciascuna fonte

**Fantacalcio.it — obbligatoria.** È l'unica che ha i dati fantacalcistici veri: ruoli Classic e Mantra, quotazioni, FVM, e soprattutto **media voto e fantamedia**. Quelle sono i voti delle pagelle, giudizi di redattori, non eventi oggettivi. Nessun'altra fonte al mondo le ha e nessuna le avrà mai.

Due file XLSX scaricabili: le **quotazioni** della stagione corrente e le **statistiche** di ogni stagione passata. Condividono la colonna `Id`, quindi si uniscono con una join banale.

**FBref — facoltativa.** Riempie i buchi che Fantacalcio.it lascia: minuti giocati, partite da titolare, presenze totali, clean sheet dei portieri, e le **date di nascita**, che al listone mancano e che servono a distinguere gli omonimi.

Con un avvertimento importante. **A gennaio 2026 FBref ha perso l'accesso ai dati Opta**: il fornitore ha revocato i feed e imposto la cancellazione immediata dei dati dal sito, e Sports Reference si è adeguata. I dati avanzati sono stati cancellati e non possono essere forniti.

Sopravvivono i dati storici di base per oltre cento competizioni, che sono esattamente quelli che ci servono. Le pagine Serie A oggi espongono Standard Stats, Goalkeeping, Shooting, Playing Time e Miscellaneous Stats: sono rimaste le tabelle da box score, mentre Passing, Possession e Goal and Shot Creation sono sparite.

Conseguenza: **xG e xA non esistono più**, non sono fermi. Understat resta una strada per il futuro, ma è una terza corrispondenza di nomi da gestire per un dato che in asta si guarda poco.

**API-Football — facoltativa, a runtime.** Solo infortuni e squalifiche. Il piano gratuito dà 100 richieste al giorno con accesso a tutti gli endpoint senza eccezioni, la quota si azzera a mezzanotte UTC e le richieste non usate si perdono. Include gli endpoint Injuries e Sidelined. Gli infortuni si chiedono per lega e stagione con una sola richiesta: anche aggiornando ogni ora saremmo a 24 su 100.

Il resto degli endpoint non serve. I trasferimenti li copre l'aggiornamento del listone, le probabili formazioni a inizio settembre non esistono, le statistiche live sono inutili prima che il campionato cominci.

---

## 2. Architettura della pipeline

```
   [tu, una volta a stagione]                  [l'app]
            │                                     │
   scarichi 4 XLSX ─────────┐                     │
   esporti 9 CSV da FBref ──┤                     │
            │               │                     │
            ▼               ▼                     ▼
   ┌──────────────────────────────┐      ┌──────────────────────┐
   │  script offline              │      │  scarica il dataset  │
   │  tools/dataset/              │──►   │  verifica l'impronta │
   │  stadio 1: Fantacalcio.it    │      │  importa in SQLite   │
   │  stadio 2: FBref (opz.)      │      └──────────────────────┘
   │  stadio 3: id esterni (opz.) │                 │
   │  normalizza, riconcilia      │                 ▼
   └──────────────────────────────┘      ┌──────────────────────┐
              │                          │  API-Football        │
       repo GitHub privata               │  infortuni, in cache │
                                         └──────────────────────┘
```

### Lo script non va su internet

Vale ancora, e ora vale per due fonti invece di una. **Lo script prende in ingresso file già presenti sul disco**, che scarichi tu a mano.

Per Fantacalcio.it sono i due tipi di XLSX. Per FBref è l'export CSV che il sito offre per ogni tabella: tre tabelle per tre stagioni, nove copia-incolla una volta a stagione.

In cambio: nessuno scraper da manutenere, nessun captcha, nessuna dipendenza dalla struttura HTML, e nessun problema di accesso automatizzato, visto che Sports Reference lo limita ma non limita certo lo scarico manuale.

Il costo onesto: tredici file da procurarsi una volta a stagione invece di quattro.

```
tools/dataset/
├── input/                              non versionato
│   ├── quotazioni-2026-27.xlsx
│   ├── statistiche-2025-26.xlsx
│   ├── statistiche-2024-25.xlsx
│   ├── statistiche-2023-24.xlsx
│   └── fbref/
│       ├── 2025-26-standard.csv
│       ├── 2025-26-playing-time.csv
│       ├── 2025-26-goalkeeping.csv
│       └── …
├── overrides.json                      versionato, decisioni manuali
├── build.ts
└── output/
    └── 2026-27/v4.json.gz
```

### Gli stadi

**Stadio 1 — Fantacalcio.it.** Obbligatorio. Produce un dataset completo e utilizzabile. Se gli altri due non girano, l'app funziona con qualche colonna in meno.

**Stadio 2 — FBref.** Facoltativo. Aggiunge minuti, titolarità, presenze totali, clean sheet e date di nascita. Se salta, il dataset esce con `hasFbref: false` e l'app nasconde le colonne corrispondenti invece di mostrarle vuote.

**Stadio 3 — Identificativi esterni.** Facoltativo. Risolve la corrispondenza con API-Football e la scrive nel dataset. Senza, lo strato dei dati vivi non ha modo di agganciare un infortunio a un giocatore, e resta spento.

Nessuno stadio può far fallire quelli precedenti. Se lo stadio 2 non trova un file, lo dice e prosegue.

---

## 3. Le fonti in dettaglio

### Fantacalcio.it

| File | Colonne rilevanti |
|---|---|
| Quotazioni (stagione corrente) | `Id`, `R`, `RM`, `Nome`, `Squadra`, `Qt.A`, `Qt.I`, `Qt.A M`, `Qt.I M`, `FVM`, `FVM M` |
| Statistiche (stagioni passate) | `Id`, `R`, `Nome`, `Squadra`, `Pv`, `Mv`, `Fm`, `Gf`, `Gs`, `Rp`, `Rc`, `R+`, `R-`, `Ass`, `Amm`, `Esp`, `Au` |

**Tre stagioni di storico.** Coprono la carriera recente di chiunque conti, includono i giovani esplosi da poco e restano leggere. Nessuno compra un giocatore nel 2026 guardando come andò nel 2022.

`Pv` sono le partite **a voto**, non le presenze. La distinzione conta e va conservata fino all'interfaccia.

### FBref

| Tabella | Colonne prese |
|---|---|
| Standard Stats | `Born` (data di nascita), `MP`, `Starts`, `Min` |
| Playing Time | `MP`, `Starts`, `Min` (più completa della Standard) |
| Goalkeeping | `CS` (clean sheet), `Starts` |

Tre tabelle per stagione, esportate in CSV dal sito.

### API-Football

Endpoint `injuries`, interrogato per lega e stagione. Una richiesta restituisce tutti gli indisponibili della Serie A.

---

## 4. Formato del dataset

### JSON compresso, non SQLite già pronto

Un JSON si apre e si legge; un `.db` binario no. Un diff fra due versioni dice cosa è cambiato tra il listone del 28 agosto e quello del 5 settembre; un diff fra due file SQLite è rumore.

E soprattutto: **il dataset è un formato di scambio, non un dettaglio interno del database.** Pubblicarlo come SQLite lo legherebbe allo schema dell'app, e ogni migrazione futura costringerebbe a rigenerare anche le stagioni passate.

Il costo è un import di meno di un secondo su seicento giocatori.

### Manifest

```json
{
  "format": "fanta-help/manifest",
  "formatVersion": 1,
  "seasons": [
    {
      "seasonId": "2026-27",
      "label": "Serie A 2026/27",
      "latest": "v4",
      "versions": [
        {
          "version": "v4",
          "publishedAt": "2026-09-05",
          "playerCount": 643,
          "hasFbref": true,
          "hasExternalIds": true,
          "url": "2026-27/v4.json.gz",
          "sha256": "a91f4c2…",
          "note": "Aggiornamento dopo la chiusura del mercato"
        }
      ]
    }
  ]
}
```

Il campo `note` compare nell'interfaccia quando l'app propone l'aggiornamento. "Aggiornamento dopo la chiusura del mercato" dice se conviene; "v4 disponibile" non dice niente.

### Dataset

```json
{
  "format": "fanta-help/dataset",
  "formatVersion": 1,
  "seasonId": "2026-27",
  "version": "v4",
  "generatedAt": "2026-09-05T18:22:00Z",
  "hasFbref": true,
  "hasExternalIds": true,
  "sources": [
    { "kind": "quotazioni",  "file": "quotazioni-2026-27.xlsx",  "sha256": "…" },
    { "kind": "statistiche", "season": "2025-26", "file": "…",   "sha256": "…" },
    { "kind": "fbref",       "season": "2025-26", "file": "…",   "sha256": "…" }
  ],
  "serieATeams": [ { "name": "Inter", "code": "INT" } ],
  "players": [
    {
      "sourceId": 2170,
      "identityKey": "fc-2170",
      "name": "Lautaro Martinez",
      "team": "Inter",
      "roleClassic": "A",
      "rolesMantra": ["A", "Pc"],
      "qtClassicInitial": 32, "qtClassicCurrent": 32,
      "qtMantraInitial": 34,  "qtMantraCurrent": 34,
      "fvmClassic": 145, "fvmMantra": 152,
      "birthDate": "1997-08-22",
      "penaltyTaker": true,
      "penaltyTakerSource": "manual",
      "externalIds": { "fbref": "d609edc0", "apiFootball": 30435 }
    }
  ],
  "stats": [
    {
      "identityKey": "fc-2170",
      "seasonId": "2025-26",
      "team": "Inter",
      "roleClassic": "A",
      "matchesRated": 34, "avgVote": 6.41, "fantaAvg": 9.12,
      "goals": 24, "goalsConceded": 0, "assists": 6,
      "penaltiesTaken": 8, "penaltiesScored": 7,
      "penaltiesMissed": 1, "penaltiesSaved": 0,
      "yellowCards": 5, "redCards": 0, "ownGoals": 0,
      "matchesPlayed": 36, "starts": 33, "minutes": 2874, "cleanSheets": null
    }
  ]
}
```

`sources` con le impronte dei file di partenza serve a una cosa: fra sei mesi, davanti a un dato strano, poter dire con certezza da quale file veniva.

### I rigoristi designati

Non stanno in nessun file, e spostano molto il valore in asta. Due strade che convivono.

**Derivazione automatica.** Chi ha calciato almeno tre rigori nella stagione precedente si marca come rigorista, con fonte `derived`. Sbaglia sistematicamente su chi ha cambiato squadra: un rigorista designato altrove non è detto che lo sia nella squadra nuova.

**Designazione manuale**, in `overrides.json`, una voce per squadra:

```json
"penaltyTakers": { "Inter": ["fc-2170"], "Juventus": ["fc-4412", "fc-3305"] }
```

Le manuali vincono sempre. Compilarle richiede dieci minuti a inizio stagione e le informazioni sono ovunque nelle guide all'asta.

La distinzione tra `derived` e `manual` arriva fino all'interfaccia: un rigorista designato a mano è un'informazione certa, uno dedotto è un indizio, e mostrarli uguali sarebbe fuorviante.

---

## 5. Riconciliazione

Due problemi diversi che la stessa macchina risolve.

### Tra stagioni

`identityKey` deve restare la stessa attraverso gli anni, altrimenti le statistiche del 2023-24 non si agganciano al giocatore del listone 2026-27.

1. **`fc-<sourceId>`**, se Fantacalcio.it mantiene lo stesso `Id` tra le stagioni. Va verificato confrontando due listoni consecutivi.
2. **Nome normalizzato più data di nascita**, dove l'`Id` è cambiato. Le date arrivano da FBref.
3. **Nome normalizzato più squadra**, ultima risorsa, con revisione manuale.

### Tra fonti

FBref e API-Football hanno i propri identificativi. La corrispondenza si fa **dentro il club**: entrambe le fonti hanno la squadra, quindi i candidati scendono da seicento a una trentina, e il cognome li separa quasi sempre.

Il caso che rende evidente perché serve: in Serie A giocano **due Thuram**, Marcus e Khéphren. Una corrispondenza sul solo cognome li fonde in una persona con statistiche assurde, e non te ne accorgi finché non guardi quella riga. Ma giocano in squadre diverse, quindi cognome più club li separa da solo. Con le date di nascita in aggiunta, la corrispondenza è deterministica.

### Normalizzazione dei nomi

```
minuscolo
  → decomposizione NFD e rimozione dei diacritici
  → rimozione di apostrofi e punteggiatura
  → collasso degli spazi multipli
```

`Vlahović`, `N'Dicka` e `Sánchez` diventano `vlahovic`, `ndicka`, `sanchez`. Serve anche alla ricerca nell'app, dove si digita senza accenti.

### Gli override

Le decisioni manuali si scrivono una volta e sopravvivono a ogni rigenerazione.

```json
{
  "aliases": [
    { "identityKey": "fc-2170", "alsoKnownAs": ["fc-8891"], "note": "Id cambiato nel listone 2025-26" }
  ],
  "birthDates": { "fc-4412": "2003-01-14" },
  "externalIds": {
    "fc-2201": { "fbref": "a1b2c3d4", "apiFootball": 1100 }
  },
  "penaltyTakers": { "Inter": ["fc-2170"] }
}
```

### Il rapporto

Ogni esecuzione produce un rapporto leggibile accanto al dataset:

```
Riconciliazione 2026-27 v4
──────────────────────────
643 giocatori nel listone
612 collegati a statistiche storiche via sourceId
 19 collegati via nome + data di nascita
  9 senza storico (esordienti o nuovi arrivi)
  3 AMBIGUI → richiedono una decisione

FBref            631/643 collegati, 12 senza corrispondenza
API-Football     628/643 collegati, 15 senza corrispondenza

AMBIGUI
  "Pereira" corrisponde a 3 identità storiche
  "Sanchez" corrisponde a 2 identità storiche
```

Lo script **fallisce** se restano ambigui non risolti negli override: o il dataset è pulito o non esce. Tre minuti di revisione l'anno valgono la certezza che nessuna riga sia sbagliata in silenzio.

Le corrispondenze mancanti con FBref e API-Football invece **non** fanno fallire: quei giocatori avranno qualche colonna in meno, non un dato sbagliato.

---

## 6. Import nell'app

### Dal dataset scaricato

1. Legge il manifest dall'URL configurato, che è fisso.
2. Confronta `latest` con la versione installata per quella stagione.
3. Scarica il `.json.gz` e verifica lo `sha256`. Se non corrisponde, si ferma.
4. Valida tutto con zod prima di toccare il database.
5. Importa in una transazione unica.

### Le regole

**Upsert su `(season_id, source_id)`.** Un reimport aggiorna quotazioni, ruoli e squadra senza toccare gli id locali, quindi gli acquisti continuano a puntare alle stesse righe.

**Chi sparisce si marca, non si cancella.** Invariante 10 del documento 1. Un giocatore ceduto all'estero a fine agosto sparisce dal listone di settembre, ma se qualcuno l'ha comprato deve restare in rosa, visibile e marcato.

**Le statistiche si sostituiscono per intero.** Non hanno riferimenti da nessuna parte, quindi cancellare e reinserire è più semplice e più sicuro.

**L'indice FTS5 si ricostruisce a ogni import.**

**Un backup del database precede ogni import.**

**Bloccato negli stati `auction`, `review` e `closed`.** Cambiare le quotazioni mentre si riconciliano i prezzi pagati è sbagliato quanto farlo durante l'asta.

### Dal file XLSX

Serve ad aggiornare le quotazioni a mercato aperto senza rigenerare il dataset, e a far funzionare l'app se la repo non è raggiungibile.

**A quale stagione appartiene?** Il file non lo dice in modo affidabile, e se non c'è mai stato un download non esiste nessuna riga in `season`. Quindi **l'import chiede sempre di confermare la stagione**, proponendo quella più recente presente o quella dedotta dal nome del file, e crea la riga `season` se manca.

**Cosa aggiorna e cosa no.** Il file quotazioni non contiene statistiche. Un import XLSX aggiorna ruoli e prezzi; lo storico resta quello che c'era. Se non c'era niente, l'app funziona ma le colonne di rendimento sono vuote, e va detto invece di lasciarlo scoprire.

### Robustezza del parser

Il file cambia impaginazione tra un anno e l'altro.

- Trova la riga di intestazione cercando quella che contiene sia `Nome` che `Squadra`, invece di assumere che sia la prima.
- Mappa le colonne **per nome dell'intestazione**, mai per posizione.
- Valida ogni riga con zod.
- Se più di una manciata di righe fallisce, **rifiuta il file intero** e mostra quali colonne non ha riconosciuto. Un import parziale silenzioso è peggio di un import fallito.

---

## 7. Lo strato dei dati vivi

L'unica parte dell'app che parla con la rete durante l'uso normale.

### Regole

**Il client HTTP sta nel main, mai nel renderer.** Tiene la chiave fuori dal processo che esegue interfaccia, lascia stretta la policy di sicurezza dei contenuti e scrive la cache direttamente in SQLite.

**Niente axios.** Il main gira su Node 22, che ha `fetch` nativo. Per un endpoint bastano trenta righe di wrapper con timeout via `AbortSignal`, un retry e la mappatura degli errori. Axios porta interceptor e pipeline di trasformazione che qui non servono.

**L'interfaccia legge sempre dalla cache, mai dalla rete.** Il refresh è esplicito o su intervallo lungo. Senza rete si vede il dato con la sua età, "infortuni aggiornati 2 giorni fa", invece di un errore o di una rotella. **Nessuna chiamata di rete blocca mai niente.**

**L'aggancio è per identificativo.** La risposta dell'API si collega ai nostri giocatori tramite `player_external_id`, risolto offline. Nessuna corrispondenza di nomi a runtime.

**Quota.** Una richiesta per lega e stagione copre tutti gli indisponibili. Refresh non più di una volta l'ora, mai automatico in ciclo. L'endpoint di stato non consuma quota e restituisce le richieste rimanenti, che arrivano comunque come header su ogni risposta: entrambi vanno mostrati nelle impostazioni.

### La chiave

Stesso problema di estraibilità del token del dataset, ma qui c'è una risposta migliore: **la chiave la mette l'utente nelle impostazioni**. Siccome è arricchimento facoltativo, "registrati gratis e incolla la chiave" è un attrito accettabile, e una chiave rubata del piano gratuito costa a qualcuno cento richieste al giorno.

Un valore predefinito iniettato in fase di build resta, per comodità del gruppo. La chiave si conserva con `safeStorage` di Electron, cifrata a riposo, non in chiaro nella configurazione.

### Degradazione

Senza chiave, senza rete, o senza identificativi esterni nel dataset, lo strato è semplicemente assente: nessuna colonna infortuni, nessun avviso in asta, tutto il resto identico.

---

## 8. Aggiornamenti del listone

L'app controlla il manifest all'avvio ma **non scarica da sola**. Mostra un avviso discreto con la nota del manifest e il bottone per aggiornare.

Il controllo fallisce in silenzio: senza rete non compare né avviso né errore. È una comodità, non una funzione critica.

---

## 9. Le due repo

Il dataset sta in una repo separata da quella dell'app, con visibilità opposta. Non è organizzazione, è conseguenza di chi possiede i dati.

| | Contenuto | Visibilità | Perché |
|---|---|---|---|
| `edocico/fanta-help` | codice, Release installabili | **pubblica** | l'aggiornamento automatico via GitHub Releases funziona senza autenticazione |
| `edocico/fanta-help-dataset` | manifest e dataset | **privata** | i dati sono di Fantacalcio.it, non vanno ridistribuiti |

Su GitHub un nome come `fanta-help/dataset` non esiste: le repo sono `proprietario/nome`. Una cartella `dataset/` dentro la repo dell'app la renderebbe pubblica insieme al codice, che è esattamente ciò da evitare.

### Il token

Una repo privata non si legge senza autenticazione, quindi l'app si porta dietro un token.

Va detto senza girarci intorno: **un token dentro un'applicazione distribuita è estraibile.** Non è un segreto, è una serratura sulla porta di casa di amici. Quello che si può fare è ridurre il danno a zero:

- Token **fine-grained**, sola lettura, valido **solo** su `fanta-help-dataset`.
- **Iniettato in fase di build** da una variabile d'ambiente, mai nel sorgente. Altrimenti finisce nella repo pubblica dell'app e GitHub lo revoca da solo in pochi minuti.
- Revocabile e sostituibile con una nuova build.

**Se il token non funziona**, l'app lo dice **una volta sola**, passa all'import XLSX e non riprova a ogni avvio. Un errore che si ripresenta a ogni apertura per una funzione facoltativa è rumore. Il ricontrollo resta disponibile a mano nelle impostazioni.

E soprattutto: l'import XLSX è una strada alternativa completa. L'app è pienamente usabile senza mai toccare la repo del dataset.

---

## 10. Rischi

**Il formato dei file cambia.** Succederà. Il parser fallisce nominando la colonna mancante, non produce un dataset silenziosamente sbagliato.

**Gli `Id` del listone non sono stabili tra stagioni.** Ipotesi da verificare confrontando due listoni consecutivi prima di scrivere il codice. Se cade, la cascata della sezione 5 la gestisce, al prezzo di più override.

**FBref cambia ancora.** Ha già perso i dati avanzati una volta. Per questo lo stadio è facoltativo e il dataset resta valido senza: se un giorno sparisce anche il resto, si perdono quattro colonne, non l'applicazione.

**API-Football cambia piano o limiti.** Stesso ragionamento: strato facoltativo, degradazione pulita.

**Licenza.** I dati di Fantacalcio.it sono proprietari e la repo del dataset è privata, condivisa solo col gruppo. FBref si consulta con l'export manuale, non con uno scraper. L'import XLSX permette a chiunque di usare l'app col proprio file scaricato per conto suo, e vale la pena tenere le due strade separate proprio per questo.

---

## 11. Punti aperti

Nessuno che blocchi la scrittura del codice.

Da rivalutare in futuro: se il gruppo si allarga, il token condiviso smette di essere ragionevole, e la strada sarà pubblicare solo un dataset ridotto ai dati non proprietari lasciando il resto all'import XLSX.

---

## Riferimenti

- Documento 1: scope e modello dati
- Documento 2: flussi e schermate
- Documento 3: architettura
