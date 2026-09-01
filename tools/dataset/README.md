# Pipeline dati

Lo stadio Fantacalcio.it del documento 4. Gira offline, non fa parte dell'app e
non viene spedito nel pacchetto: le sue dipendenze stanno in `devDependencies`.

## Dove stanno i file

```
tools/dataset/
  input/                 ← i file scaricati a mano. IGNORATO da git.
    Quotazioni_…xlsx     ← obbligatori: lo stadio 1
    Statistiche_…xlsx
    fbref/               ← facoltativi: lo stadio 2
    api-football/        ← facoltativi: lo stadio 3
  output/                ← il dataset e il rapporto. IGNORATO da git.
```

Le due cartelle sono ignorate di proposito, non per distrazione. Il documento 4
§9: questa repo è pubblica perché l'aggiornamento via GitHub Releases funzioni
senza autenticazione, ma i listoni sono di Fantacalcio.it e non vanno
ridistribuiti. Manifest e dataset vivono in una repo privata separata. Qui sta
lo script, mai la sua materia prima.

Lo script non va su internet: i file si scaricano a mano e lui legge il disco.

## Cosa decide la verifica, e cosa non decide

Non decide la forma di `identity_key`. Quella la fissa il documento 1: è sempre
`fc-<sourceId>`, perché il file quotazioni non contiene le date di nascita e
l'import XLSX di riserva deve poter generare la chiave da quel file da solo.

I tre livelli del documento 4 §5 non sono formati di chiave in concorrenza: sono
modi di decidere **quali righe storiche appartengono alla chiave che il listone
corrente dà a un giocatore**. Le righe passate vengono riscritte sulla chiave di
oggi, ed è esattamente ciò che registra `alsoKnownAs` in `overrides.json`.

Quindi la verifica decide una cosa sola: con quale livello si aggancia lo
storico. Il livello 1 è un confronto fra interi. Il livello 2 vuole le date di
nascita, che arrivano da FBref — cioè da T6, un task che viene **dopo** questo.

## Costruire il dataset

```
npm run dataset:build -- [--season 2026-27] [--version v2] [--note "…"]
```

Trova da solo i file in `input/` dal loro nome, ricava la stagione, e prende come
listone corrente il più recente. Senza `--version` numera da sé la prossima.

Cosa esce, in `output/`:

```
output/
  manifest.json          ← aggiornato a ogni giro, mai riscritto da zero
  2026-27/
    v1.json.gz           ← il dataset
    v1.txt               ← il rapporto, accanto come vuole il documento 4 §5
```

**La proiezione.** Il dataset descrive i giocatori del listone più recente e
nessun altro. Chi ha lasciato la Serie A non ha una riga, perché all'asta non lo
puoi comprare, e le sue statistiche vengono scartate: sui file 2023-24 → 2026-27
sono 1.151 righe su 2.568, quasi la metà di quello che viene letto.

**Due esecuzioni sugli stessi file danno lo stesso file**, a parte `generatedAt`:
giocatori ordinati per `sourceId`, statistiche per chiave e stagione. Serve al
diff fra due versioni, che è metà del motivo per cui il formato è JSON e non
SQLite.

**Lo script si rifiuta di scrivere** se resta un'identità da decidere, e esce
con 1. Vedi la sezione qui sotto.

### Quando chiede una decisione

L'aggancio per `Id` ha un solo punto cieco: un giocatore a cui l'`Id` è cambiato
sembra in tutto e per tutto un esordiente. Per questo, di ogni giocatore senza
storico, lo script cerca il nome normalizzato nelle statistiche. Se lo trova
sotto un altro `Id`, si ferma e lo dice.

Si risolve in `overrides.json`, in un modo o nell'altro:

```json
{ "aliases": [
  { "identityKey": "fc-9999", "alsoKnownAs": ["fc-1111"], "note": "Id cambiato al rientro" },
  { "identityKey": "fc-9500", "alsoKnownAs": [], "note": "omonimo, non è lui" }
] }
```

`alsoKnownAs` vuoto significa «controllato, questo giocatore non ha davvero uno
storico»: chiude il caso senza inventare una sezione che il documento non
descrive. Le decisioni si scrivono una volta e sopravvivono a ogni rigenerazione,
quindi `overrides.json` è versionato — è l'unico artefatto di questa pipeline che
deve seguirti fra le due macchine.

**I rigoristi.** Chi ha calciato almeno tre rigori nell'ultima stagione passata
si marca `derived`. Le designazioni manuali in `overrides.json` vincono sempre e
si marcano `manual`, e la distinzione arriva fino all'interfaccia: un rigorista
designato a mano è certo, uno dedotto è un indizio.

## Gli stadi facoltativi

Il documento 4 §2 li chiama facoltativi e lo intende in senso forte: **nessuno dei
due può far fallire la build**. Quello che non riescono a fare diventa una riga
del rapporto, perché un giocatore con quattro colonne vuote è una riga che
funziona e una pipeline ferma no.

Si accendono da soli quando i file ci sono. Non c'è un'opzione per saltarli:
cancellare la cartella è l'opzione.

### Stadio 2 — FBref

Nove CSV esportati a mano dal sito, in `input/fbref/`, nominati
`<stagione>-<tabella>.csv`:

```
2025-26-standard.csv        Born, MP, Starts, Min
2025-26-playing-time.csv    MP, Starts, Min — più completa, ha la precedenza
2025-26-goalkeeping.csv     CS
```

Le tabelle sono tre e non una perché si contraddicono, e la precedenza è quella
del documento §3. Un punto merita di essere detto: **le presenze da titolare di
Goalkeeping sono le presenze in porta**, e lasciarle scrivere sopra a quelle
generali riscriverebbe la stagione di ogni portiere. Non lo fanno, e c'è un test
che se ne accorge.

Un file col nome fuori schema finisce nel rapporto invece di essere ignorato:
`2025-26-standard-stats.csv` che sta lì senza fare niente ha lo stesso aspetto di
FBref che non copre quella stagione.

**`Born` è l'anno, non la data.** Va in `birthYear`. Se un giorno FBref lo toglie
come ha già tolto i dati Opta, il file continua a valere per le altre tre colonne
e il rapporto dice che gli anni non ci sono.

### Stadio 3 — Identificativi esterni

Le rose di API-Football, salvate a mano in `input/api-football/`, un file per
club, con qualunque nome:

```
curl -H 'x-apisports-key: …' \
  'https://v3.football.api-sports.io/players/squads?team=505' \
  > tools/dataset/input/api-football/inter.json
```

Ventun richieste su cento al giorno, una volta a stagione. Vanno bene sia la
risposta intera sia il solo array che contiene, e sia `players/squads` sia
`players`: quello che sei riuscito a salvare è quello che lo stadio usa.

Serve a una cosa sola, ed è il documento 4 §7 a dirlo: senza id esterni lo strato
degli infortuni non ha modo di agganciare una risposta a un giocatore, e resta
spento. Per questo `hasExternalIds` risponde dell'id API-Football e non di quello
FBref — un dataset con soli id FBref accenderebbe la colonna infortuni senza
avere niente da metterci.

### Come si agganciano, e cosa succede quando non ci riescono

**Dentro il club**, come vuole il documento §5. È l'unica ragione per cui una
corrispondenza per nome è difendibile: in Serie A giocano due Thuram, e sul solo
cognome diventano una persona sola con numeri assurdi che nessuno nota. Giocano
in squadre diverse, e questo li separa.

Il club si riconosce **per parola condivisa**, ricavata dal listone a ogni
esecuzione invece che da una tabella: `Hellas Verona` e `Verona` hanno una parola
in comune, `AC Milan` e `Milan` pure. Una tabella scritta a mano sarebbe sbagliata
una volta l'anno, a luglio, mesi prima che qualcuno rilanci la pipeline.

Sui nomi si contano le parole condivise, e il punteggio più alto deve essere di
**uno solo**. Le iniziali non fanno punteggio — `Rossi M.` e `M. Bianchi`
condividono la lettera `m` e nient'altro.

Poi vengono due veti, e sono veti e non spareggi apposta. Uno spareggio entra in
gioco solo quando due candidati sono pari, mentre il caso ordinario è che il
candidato sia **uno solo**: FBref elenca chi è sceso in campo, il listone porta
anche chi non ha giocato. Una Roma con `Pellegrini Lo.` e `Pellegrini Lu.` sul
listone e il solo Lorenzo nell'export regalava a Luca i duemiladuecento minuti di
Lorenzo, senza opposizione, e il rapporto lo contava come aggancio pulito.

- **L'abbreviazione del listone.** `Lu.` va confrontata come *prefisso* e va letta
  **prima** della normalizzazione, che il punto se lo mangia: ridotta all'iniziale
  `l`, non distingue più Luca da Lorenzo, che è esattamente la coppia per cui il
  listone scrive due lettere. Se nessuna parola del candidato comincia per `lu`,
  non è lui.
- **L'anno di nascita**, quando `overrides.json` ne dà uno e il candidato ne ha uno
  suo. Se non coincidono, non è lui, fosse anche l'unico in campo.

Chi sopravvive ai veti passa agli spareggi — prima le iniziali, poi l'anno — e se
resta un pareggio è ambiguo. Ambiguo vuol dire **nessun aggancio**, non un
aggancio a caso.

Infine, **due giocatori del listone non possono essere la stessa riga**. Ogni
aggancio è deciso per conto suo, quindi una collisione è invisibile da entrambi i
lati: sembrano due corrispondenze pulite. Quando succede la riga non va a nessuno
dei due e il rapporto li nomina entrambi. Lo stesso vale per un id API-Football
conteso, dove la conseguenza è più netta: un infortunio solo accenderebbe due
righe nell'app.

Le corrispondenze mancanti **non fermano niente**, al contrario delle ambiguità di
identità dello stadio 1. La differenza è nella conseguenza: un'identità sbagliata
dà a qualcuno lo storico di un altro, una corrispondenza mancata gli lascia quattro
colonne vuote.

### Chi cambia squadra a stagione in corso

FBref gli dà una riga per squadra, Fantacalcio.it una sola: agganciare dentro il
club troverebbe metà dei suoi minuti. Le parti si risommano, ma **solo quando
l'anno di nascita dice che è la stessa persona**. È esattamente il caso che non
deve fondere i due Thuram, e 1997 contro 2001 li tiene separati.

Quando l'anno manca la somma non si fa, e il rapporto lo dice: una stagione
ridotta ai minuti di un club sola ha lo stesso aspetto di una stagione passata
davvero lì.

### Quello che non è ancora stato verificato

Il lettore CSV è scritto sulle colonne che il documento 4 §3 elenca e sul formato
che l'export di FBref è documentato produrre — intestazione di gruppo sopra quella
vera, intestazioni ripetute in mezzo alle righe, migliaia separate da virgola,
`Save%` due volte in Goalkeeping. **Non è ancora passato su un export vero**, perché
i CSV non erano a portata quando lo stadio è stato scritto.

Se il formato è diverso, il modo in cui lo si scopre è quello giusto: il lettore
cerca l'intestazione e nomina la colonna che non riconosce, invece di leggere la
colonna sbagliata in silenzio. Al primo export vero, guarda il rapporto prima del
dataset.

---

## Verifica di stabilità degli Id

Va lanciata **prima** di scrivere il parser.

```
npm run dataset:verify-ids -- input/2023-24.xlsx input/2024-25.xlsx input/2025-26.xlsx
```

I listoni vanno in ordine cronologico, dal più vecchio al più recente. Ne bastano
due, ma **tre cambiano cosa si riesce a misurare**.

| Esito | Significato |
|---|---|
| presenza continua, Id invariato | il livello 1 regge |
| presenza continua, Id cambiato | serve un alias in `overrides.json` |
| rientro, Id sopravvissuto al vuoto | il livello 1 regge anche attraverso un'assenza |
| **rientro, Id nuovo** | l'Id non sopravvive all'uscita dal listone |
| stesso Id, nomi senza niente in comune | **riciclato**: agganciare per Id darebbe a qualcuno le statistiche di un altro |
| stesso Id, nomi con una parola in comune | probabile cambio di grafia, da guardare a occhio |

### Perché tre listoni e non due

Con due sole stagioni consecutive, chi esce dalla Serie A e torna l'anno dopo è
invisibile: risulta «uscito» nel primo confronto e «nuovo arrivo» nel secondo, e
non viene mai messo alla prova. È il caso in cui l'Id ha più probabilità di
essere cambiato, perché il giocatore è stato tolto dal listone e poi rimesso.
Con tre stagioni quel vuoto si vede, e i rientri diventano una categoria a sé.

Con due soli file lo script lo dice invece di stampare zero: uno zero che
significa «non misurabile» letto come «nessun rientro» è peggio di niente.

### Cosa la verifica non copre, per costruzione

Il confronto passa per il nome normalizzato, perché il nome è l'unica cosa di
cui fidarsi quando l'Id è esattamente ciò che è in discussione. Ne segue che
restano fuori:

- **chi compare in un listone solo** — esordienti e nuovi arrivi. Non dicono
  niente sull'Id perché non hanno un prima da confrontare;
- **i nomi ripetuti dentro lo stesso listone** — non sono appaiabili per nome, e
  contarli falserebbe la percentuale in una direzione che dipende dal caso.

Per questo il rapporto chiude con la **copertura**: quanti giocatori del listone
più recente la verifica ha davvero potuto giudicare. Il verdetto vale su quelli,
non su tutti, e il numero va guardato prima della percentuale.

## La soglia degli alias

`judge()` in `verify-ids.ts` decide su due piani, e solo uno dei due è una
quantità.

**Il primo non lo è.** Se anche un solo Id è riciclato — due nomi senza niente in
comune sotto lo stesso numero — agganciare lo storico per Id è fuori discussione:
un giocatore si ritroverebbe le statistiche di un altro, e sarebbe
indistinguibile da un dato vero. Un caso solo basta, e il verdetto scende a
`name-birthdate`.

**Il secondo sì**, ed è `TOLERATED_ALIAS_RATE`: l'1% dei nomi confrontabili.
Nessun Id riciclato ma un tot di Id cambiati non rompe niente — ogni scarto si
copre con un alias in `overrides.json`. Ma ogni alias è una riga scritta a mano da
rivedere ogni anno, e la domanda è quante se ne sopportano. All'1% di seicento
nomi confrontabili sono sei righe: una lista che si legge tutta. Al 5% sono
trenta, e lì dipendere da FBref costa meno che tenere il passo a mano.

Il rapporto conta a parte gli Id cambiati **al rientro**, ed è il numero da
guardare per primo il giorno che la soglia si avvicina. Se il movimento sta quasi
tutto lì, il livello 1 regge per chi resta di fila e gli alias coprono pochi casi
riconoscibili. Se invece cambiano Id anche i presenti continui, la lista cresce
ogni stagione senza mai chiudersi, e la percentuale di oggi dice poco su quella
dell'anno prossimo.

Sui quattro listoni dal 2023-24 al 2026-27 il verdetto è `source-id`: **0 Id
cambiati su 589 confrontabili**, 0 riciclati. Non è un margine stretto, è zero. È
il motivo per cui la riconciliazione di T5 aggancia lo storico per `sourceId` e
non per nome e data di nascita.

Lo script esce 0 solo su `source-id`. `name-birthdate` non è un errore: è una
strategia diversa, che la pipeline oggi non implementa. Uscire 0 la farebbe
sembrare una corsa andata bene, mentre chiede di riscrivere la riconciliazione.

**La soglia non è mai scattata.** Nessuna delle quattro stagioni la avvicina e non
c'è un test che la eserciti: il ramo sopra l'1% è scritto e mai percorso. Se un
giorno un listone lo imbocca, il primo sospetto non è la soglia — è che il listone
abbia cambiato il modo di assegnare gli Id, e vada guardato a occhio prima di
alzare la costante.
