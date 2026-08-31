# CLAUDE.md

App desktop di supporto all'asta del fantacalcio di Serie A. Uso privato, un gruppo di amici. Serve a preparare l'asta e a registrarla dal vivo. Non gestisce il campionato.

Le specifiche complete stanno in `docs/`. Leggi il documento indicato nel task, non tutti.

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
| electron-vite | `externalizeDepsPlugin()` in `main` e `preload`, o la build fallisce in modo illeggibile |
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

Se una specifica è ambigua o sbagliata, fermati e chiedi. Non indovinare e non "sistemare" silenziosamente una scelta che sembra strana: quasi tutte le stranezze in questi documenti sono deliberate e motivate.
