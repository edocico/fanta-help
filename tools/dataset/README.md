# Pipeline dati

Lo stadio Fantacalcio.it del documento 4. Gira offline, non fa parte dell'app e
non viene spedito nel pacchetto: le sue dipendenze stanno in `devDependencies`.

## Dove stanno i file

```
tools/dataset/
  input/     ← i file scaricati a mano. IGNORATO da git.
  output/    ← il dataset e il rapporto. IGNORATO da git.
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

## La decisione ancora aperta

`judge()` in `verify-ids.ts` decide metà della questione da sola: se anche un
solo Id è riciclato, agganciare lo storico per Id è fuori discussione. Non è una
quantità — un giocatore si ritroverebbe le statistiche di un altro, e sarebbe
indistinguibile da un dato vero.

L'altra metà è un giudizio e non è ancora scritta. Nessun Id riciclato ma un tot
di Id cambiati: quanti sono troppi? Gli `aliases` di `overrides.json` esistono
apposta, ma ogni alias è una riga scritta a mano da rivedere ogni anno, e a un
certo punto costa più che dipendere da FBref.

Vale la pena guardare **dove** cade il movimento. Se è quasi tutto nei rientri,
il livello 1 regge per chi resta e servono pochi alias, riconoscibili. Se invece
cambiano Id anche i presenti di fila, la lista degli alias cresce ogni stagione
senza mai chiudersi.

Finché non è deciso, il verdetto è `undecided` e lo script esce con 1: una
domanda senza risposta non deve sembrare una corsa andata bene.
