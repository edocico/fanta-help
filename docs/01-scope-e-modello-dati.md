# Fanta-Help — Documento 1: Scope MVP e modello dati

> Revisione 2. Incorpora i rilievi della revisione, il rientro di FBref come stadio facoltativo e lo strato dei dati vivi.

---

## 1. Decisioni fissate

| Ambito | Decisione |
|---|---|
| Modalità di gioco | **Classic + Mantra** entrambe dalla v1 |
| Fonti dati | **Fantacalcio.it** (obbligatoria) + **FBref** (arricchimento facoltativo) + **API-Football** (dati vivi, facoltativo) |
| Distribuzione dataset | Download da repo GitHub privata + import XLSX come alternativa completa |
| Formato asta | **A chiamata con rilanci** e **draft a turni**, selezionabile per lega |
| Persistenza | SQLite locale (better-sqlite3 + Drizzle) nel processo main |
| Aggiornamento app | **Incluso nella v1**, via GitHub Releases |
| Rete | Nessuna sync tra istanze in v1. Export/import JSON |
| Chiusura | Fase di **revisione** modificabile, poi **cristallizzazione versionata** |

---

## 2. Scope della v1

### Dentro

**Setup dati**
- Al primo avvio l'app scarica il dataset della stagione corrente e lo importa in SQLite.
- Import manuale di un file XLSX del listone, per aggiornare le quotazioni a mercato aperto e come strada alternativa completa se il download non è disponibile.
- Il dataset è versionato per stagione. Più stagioni coesistono nel database.

**Gestione lega**
- Creazione: nome, stagione, modalità, formato asta, budget, puntata minima, modificatore di difesa.
- Squadre partecipanti: nome, allenatore, ordine, colore, flag "questa è la mia".
- Slot per ruolo, predefiniti 3/8/8/6.
- Più leghe coesistono.

**Consultazione giocatori**
- Tabella di tutti i giocatori con quotazioni Classic e Mantra, FVM, ruoli, squadra.
- Statistiche storiche: partite a voto, MV, FM, gol fatti e subiti, assist, rigori, cartellini.
- Se lo stadio FBref è stato eseguito: presenze totali, partite da titolare, minuti, clean sheet.
- Se lo strato dati vivi è configurato: stato di infortunio o squalifica, con la data dell'ultimo aggiornamento.
- Filtri combinabili, ricerca istantanea con tolleranza ai refusi, scheda di dettaglio con lo storico.

**Preparazione all'asta**
- Liste di obiettivi per lega: fascia, prezzo massimo, rating, note.
- Simulazione rosa entro budget e slot, con più piani alternativi confrontabili.

**Asta live**
- Registrazione acquisto con pochi tasti, command palette, undo, cronologia.
- Dashboard di tutte le rose: slot per ruolo, crediti residui, puntata massima, spesa per reparto.
- Avvisi bloccanti sui vincoli e **avviso non bloccante se il giocatore selezionato è infortunato**.
- Modo proiezione per un secondo schermo.

**Revisione e chiusura**
- Stato di revisione con tutti gli acquisti liberamente modificabili in una tabella unica.
- Pannello controlli con le anomalie raggruppate per squadra, tutte mostrate, mai bloccanti.
- Cristallizzazione: snapshot numerato con data e impronta. Riapribile, le versioni precedenti restano.
- Export in XLSX e JSON, import JSON per riprendere o spostare una sessione.

**Aggiornamento dell'applicazione**
- Controllo automatico all'avvio, download e installazione su richiesta esplicita.

### Fuori dalla v1

| Rimandato | Perché |
|---|---|
| Sincronizzazione LAN | Complessità sproporzionata. Le fondamenta (identità stabili, snapshot versionati) si posano adesso. |
| Riconciliazione tra versioni di partecipanti diversi | Serve la LAN. In v1 c'è solo la versione dell'admin. |
| Gestione del campionato (formazioni, punteggi, calendario) | È un'altra app. Qui ci si ferma alla chiusura dell'asta. |
| Probabili formazioni | A inizio settembre non esistono ancora in forma utile. |
| xG e xA | La fonte non esiste più: FBref ha perso l'accesso ai dati avanzati a gennaio 2026. Understat resta una strada per il futuro. |
| Previsioni con modelli statistici | Prima serve che l'app funzioni. |
| Verifica di copertura dei moduli Mantra | Candidato numero uno per la v1.1. |

---

## 3. Modello di dominio

Il database si divide in tre strati, e la separazione è la scelta architetturale più importante del documento.

**Dati di riferimento** — stagioni, squadre di Serie A, giocatori, quotazioni, statistiche. Di sola lettura per l'utente, rigenerati a ogni import, mai modificati a mano.

**Dati utente** — leghe, squadre partecipanti, acquisti, obiettivi, piani. L'unica cosa che l'utente crea e l'unica che va protetta nei backup.

**Dati vivi** — disponibilità dei giocatori. Provengono dalla rete, hanno una data di scadenza implicita e sono una cache: se spariscono, l'app funziona lo stesso con qualche colonna in meno.

Conseguenza pratica: un reimport del listone a mercato aperto non deve mai toccare gli acquisti registrati. L'import fa un upsert, non un `DELETE`+`INSERT`.

```
app_instance                        (riga unica: identità di questa installazione)

season
 ├── serie_a_team
 └── player ──┬── player_mantra_role
              ├── player_external_id       (fbref, apiFootball)
              ├── player_availability      (cache dei dati vivi)
              │
              └─(identity_key)─── player_season_stat

league
 ├── league_slot
 ├── fanta_team ──── purchase ────► player
 ├── target ────────────────────► player
 ├── plan ──── plan_item ────────► player
 ├── auction_log
 └── league_snapshot
```

### Identità stabili

Gli id autoincrement funzionano dentro un database, non tra database diversi. Siccome in futuro due istanze dovranno confrontare le loro versioni dello stesso resoconto, **lega, squadre partecipanti e acquisti portano un UUID** oltre all'id locale. L'id resta la chiave interna, l'UUID è l'identità che viaggia negli export.

Per i giocatori l'identità che viaggia è `identity_key`, nella forma `fc-<sourceId>` costruita sull'`Id` del listone di Fantacalcio.it.

La scelta di quella forma non è estetica. Il file quotazioni **non contiene le date di nascita**, quindi una chiave costruita su nome più data non sarebbe generabile durante un import XLSX, che è la strada di riserva su cui l'app deve poter contare sempre. La chiave basata sull'`Id` si genera da entrambe le fonti.

### Identità tra fonti diverse

FBref e API-Football hanno ciascuno i propri identificativi. Farli corrispondere ai nostri **a runtime** sarebbe fragile e avverrebbe nel momento peggiore, durante l'asta.

La corrispondenza si risolve **offline**, nello script che genera il dataset, e viaggia dentro di esso in `player_external_id`. A runtime le ricerche sono sempre per identificativo e sempre deterministiche. La stessa struttura accoglie qualsiasi fonte futura senza toccare l'architettura.

### Entità

**Season** — la stagione del listone. Porta versione del dataset e data di import, così l'app può dire "stai usando il listone del 28 agosto" e proporre un aggiornamento.

**SerieATeam** — le 20 squadre. Entità separata perché serve filtrare per squadra.

**Player** — il calciatore in una stagione: ruolo Classic, quotazioni, FVM, rigorista designato. Non contiene statistiche, che sono storiche e coprono più stagioni.

**PlayerMantraRole** — separata perché nel Mantra un giocatore ha da uno a tre ruoli (`Dc;Ds`, `E;W`, `T;A`). In una stringa non si potrebbe filtrare con un indice. `position` conserva l'ordine del listone, che indica la preferenza.

**PlayerExternalId** — la corrispondenza con FBref e API-Football, risolta offline.

**PlayerSeasonStat** — le statistiche di una stagione, agganciate a `identity_key`. Le colonne provenienti da Fantacalcio.it sono sempre presenti, quelle da FBref solo se lo stadio facoltativo è stato eseguito.

**PlayerAvailability** — cache dello stato di infortunio o squalifica, con la data del recupero. Non è un dato di riferimento e non è un dato utente: è una fotografia con una scadenza.

**League** — budget, puntata minima, modalità, formato asta, modificatore di difesa, pesi del punteggio, stato.

**LeagueSlot** — quanti giocatori per ruolo.

Nota su Mantra: la composizione della rosa resta governata dai ruoli Classic, che il listone fornisce sempre. I ruoli Mantra servono per valutazione e filtri, non per contare gli slot. Questo evita di dover decidere a mano se un `E` conti come difensore o centrocampista: lo decide già la colonna Classic.

**FantaTeam** — una squadra partecipante. `is_mine` marca la tua, `order_index` definisce il turno.

**Purchase** — chi ha comprato chi, a quanto, in che slot. `sequence` dà l'ordine per l'undo.

**AuctionLog** — registro append-only. Serve alla cronologia. Non è la sorgente di verità: quella resta `purchase`.

**Target** — un giocatore che ti interessa, con fascia, prezzo massimo, rating e note. Legato alla lega perché il prezzo massimo dipende da quel budget.

**Plan / PlanItem** — una rosa simulata.

**AppInstance** — riga unica creata al primo avvio, con UUID ed etichetta leggibile. Firma gli snapshot.

**LeagueSnapshot** — un resoconto cristallizzato: il JSON completo, un numero di versione, l'impronta e l'istanza che l'ha prodotto. Non è un backup, è la fotografia ufficiale di com'è finita l'asta secondo chi l'ha firmata.

### Ciclo di vita di una lega

```
setup ──► pre_auction ──► auction ──► review ──► closed
                                        ▲            │
                                        └────────────┘
                                          riapri
```

**`review`** serve perché durante l'asta si sbaglia. Cadono i vincoli di velocità e valgono quelli di correttezza: ogni acquisto è modificabile in ogni campo. Le anomalie si mostrano ma non bloccano, perché mentre sistemi una rosa il database attraversa per forza stati incoerenti.

**`closed`** significa cristallizzato. Sola lettura, con almeno uno snapshot. Riaprire riporta a `review`; la cristallizzazione successiva crea la versione 2 e la 1 resta.

### Admin e partecipanti

Ogni lega registra se questa installazione è quella dell'admin o quella di un partecipante. In v1 cambia solo come viene marcato l'export. Il valore sta nel futuro: quando ci sarà la LAN, la riconciliazione sarà un confronto tra JSON che condividono gli stessi UUID.

### Stato non persistito

Il rilancio in corso e l'offerta più alta del momento **non vanno in database**. Vivono nel renderer e diventano una riga in `purchase` solo quando il rilancio si chiude. Questo tiene il database pulito, rende l'undo banale ed elimina il recupero sessione: ogni acquisto è una transazione singola, non esiste nulla da perdere.

---

## 4. Schema SQLite

### Dati di riferimento

```sql
CREATE TABLE season (
  id              TEXT PRIMARY KEY,        -- '2026-27'
  label           TEXT NOT NULL,
  dataset_version TEXT NOT NULL,           -- 'v4', allineato al manifest
  source          TEXT NOT NULL,           -- origine dell'ULTIMO import: 'github' | 'xlsx'
  has_fbref       INTEGER NOT NULL DEFAULT 0,  -- lo stadio facoltativo è stato eseguito?
  imported_at     INTEGER NOT NULL
);

CREATE TABLE serie_a_team (
  id        INTEGER PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  code      TEXT,
  UNIQUE (season_id, name)
);

CREATE TABLE player (
  id                   INTEGER PRIMARY KEY,
  season_id            TEXT NOT NULL REFERENCES season(id) ON DELETE CASCADE,
  source_id            INTEGER NOT NULL,     -- colonna 'Id' del listone
  identity_key         TEXT NOT NULL,        -- 'fc-<source_id>'
  name                 TEXT NOT NULL,        -- come lo scrive il listone: un cognome, più
                                             -- un'abbreviazione dove due lo condividono
  name_normalized      TEXT NOT NULL,        -- i quattro passi del documento 4: minuscolo,
                                             -- NFD senza diacritici, via apostrofi e
                                             -- punteggiatura, spazi collassati
  full_name            TEXT,                 -- il nome per cui è conosciuto, da FBref. Nullo per
                                             -- chi lo stadio 2 non aggancia, e per tutti finché
                                             -- non gira. Non ha una gemella normalizzata:
                                             -- name_normalized esiste per un indice e non la
                                             -- rilegge nessuna query, e la ricerca che usa questo
                                             -- campo vive nel renderer (documento 3 §5).
                                             -- Aggiunta in T6/T14b con 0002_player_full_name.sql
  serie_a_team_id      INTEGER NOT NULL REFERENCES serie_a_team(id),
  role_classic         TEXT NOT NULL CHECK (role_classic IN ('P','D','C','A')),
  qt_classic_initial   REAL,
  qt_classic_current   REAL,
  qt_mantra_initial    REAL,
  qt_mantra_current    REAL,
  fvm_classic          REAL,
  fvm_mantra           REAL,
  birth_date           TEXT,                 -- scritta a mano in overrides.json. Vedi documento 4 §1
  birth_year           INTEGER,              -- da FBref, che dà l'anno e non la data. Due colonne e
                                             -- non una: '1997' e '1997-08-22' non si confrontano,
                                             -- e una colonna che a volte è l'uno e a volte l'altro
                                             -- costringe a misurare una stringa prima di fidarsene.
                                             -- Aggiunta in T7 con 0001_player_birth_year.sql
  penalty_taker        INTEGER NOT NULL DEFAULT 0,
  penalty_taker_source TEXT CHECK (penalty_taker_source IN ('derived','manual')),
  delisted_at          INTEGER,              -- sparito da un listone successivo
  UNIQUE (season_id, source_id)
);

CREATE INDEX idx_player_season_role ON player (season_id, role_classic);
CREATE INDEX idx_player_team        ON player (serie_a_team_id);
CREATE INDEX idx_player_identity    ON player (identity_key);
CREATE INDEX idx_player_name_norm   ON player (name_normalized);

CREATE TABLE player_mantra_role (
  player_id INTEGER NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,                 -- Por Dc Dd Ds E M C W T A Pc
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, role_code)
);

CREATE INDEX idx_mantra_role ON player_mantra_role (role_code);

CREATE TABLE player_external_id (
  player_id   INTEGER NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('fbref','apiFootball')),
  external_id TEXT NOT NULL,
  PRIMARY KEY (player_id, source)
);

-- l'indice che rende deterministica la ricerca partendo da una risposta API
CREATE INDEX idx_ext_lookup ON player_external_id (source, external_id);

CREATE TABLE player_season_stat (
  id                INTEGER PRIMARY KEY,
  identity_key      TEXT NOT NULL,
  -- NESSUNA chiave esterna, e non va aggiunta: le statistiche coprono stagioni
  -- che non hanno una riga in `season`, perché lì stanno solo quelle con un listone.
  season_id         TEXT NOT NULL,
  team_name         TEXT,
  role_classic      TEXT,

  -- da Fantacalcio.it, sempre presenti
  matches_rated     INTEGER,               -- 'Pv', partite A VOTO, non presenze
  avg_vote          REAL,                  -- 'Mv'
  fanta_avg         REAL,                  -- 'Fm'
  goals             INTEGER,               -- 'Gf'
  goals_conceded    INTEGER,               -- 'Gs', portieri
  assists           INTEGER,               -- 'Ass'
  penalties_taken   INTEGER,               -- 'Rc'
  penalties_scored  INTEGER,               -- 'R+'
  penalties_missed  INTEGER,               -- 'R-'
  penalties_saved   INTEGER,               -- 'Rp'
  yellow_cards      INTEGER,               -- 'Amm'
  red_cards         INTEGER,               -- 'Esp'
  own_goals         INTEGER,               -- 'Au'

  -- da FBref, nulle se lo stadio facoltativo non è stato eseguito
  matches_played    INTEGER,               -- 'MP', presenze totali
  starts            INTEGER,               -- 'Starts'
  minutes           INTEGER,               -- 'Min'
  clean_sheets      INTEGER,               -- 'CS', portieri

  UNIQUE (identity_key, season_id)
);

CREATE INDEX idx_stat_identity ON player_season_stat (identity_key);
```

Nota su `matches_rated`. È `Pv`, le partite in cui il giocatore ha **preso un voto**, non le presenze. La distinzione conta: al fantacalcio quello che rende è la giornata a voto, non quella in cui è entrato per dieci minuti senza pagella. Con `matches_played` da FBref, la differenza tra i due valori approssima gli ingressi da subentrato. Nell'interfaccia la colonna si chiama `Pv`, che nel gergo del fantacalcio si legge senza spiegazioni.

### Dati vivi

```sql
CREATE TABLE player_availability (
  player_id       INTEGER PRIMARY KEY REFERENCES player(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('available','injured','suspended','doubtful')),
  reason          TEXT,                    -- 'Lesione muscolare'
  expected_return TEXT,                    -- data o descrizione libera
  source          TEXT NOT NULL,           -- 'api-football'
  fetched_at      INTEGER NOT NULL
);
```

È una cache, non una fonte di verità. L'interfaccia legge sempre da qui, mai dalla rete, e mostra sempre l'età del dato.

### Ricerca full-text

```sql
CREATE VIRTUAL TABLE player_fts USING fts5 (
  name,
  team_name,
  content = '',
  tokenize = "unicode61 remove_diacritics 2"
);
```

Tabella contentless, popolata all'import con `rowid = player.id`. Nessun trigger: i dati di riferimento cambiano solo durante un import, quindi l'indice si ricostruisce lì.

**`full_name` non è indicizzato qui, ed è una scelta.** La ricerca dell'asta e quella della vista Giocatori vivono nel renderer, in memoria, con uFuzzy: il documento 3 §5 dice che questo indice serve alle query fatte dal main, e oggi nessuna lo interroga. Aggiungere una colonna a una tabella FTS5 non è nemmeno un `ALTER TABLE` — le tabelle virtuali lo rifiutano, «virtual tables may not be altered» — quindi costerebbe una migrazione che la ricrea e due punti di ricostruzione da tenere allineati, per un indice che nessuno legge. Il giorno in cui una ricerca nascesse nel main, questa riga è il posto dove cambiare idea.

### Dati utente

```sql
CREATE TABLE app_instance (
  id         INTEGER PRIMARY KEY CHECK (id = 1),   -- riga unica
  uuid       TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE league (
  id               INTEGER PRIMARY KEY,
  uuid             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  season_id        TEXT NOT NULL REFERENCES season(id),
  mode             TEXT NOT NULL CHECK (mode IN ('classic','mantra')),
  auction_format   TEXT NOT NULL CHECK (auction_format IN ('call','draft')),
  budget           INTEGER NOT NULL DEFAULT 500,
  min_bid          INTEGER NOT NULL DEFAULT 1,
  defense_modifier INTEGER NOT NULL DEFAULT 0,
  scoring_weights  TEXT,                  -- JSON, pesi del punteggio sintetico
  instance_role    TEXT NOT NULL DEFAULT 'admin'
                   CHECK (instance_role IN ('admin','participant')),
  status           TEXT NOT NULL DEFAULT 'setup'
                   CHECK (status IN ('setup','pre_auction','auction','review','closed')),
  current_turn_team_id INTEGER REFERENCES fanta_team(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE league_slot (
  league_id INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL CHECK (role_code IN ('P','D','C','A')),
  slots     INTEGER NOT NULL CHECK (slots >= 0),
  PRIMARY KEY (league_id, role_code)
);

CREATE TABLE fanta_team (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  league_id   INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  manager     TEXT,
  is_mine     INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL,
  color       TEXT,
  UNIQUE (league_id, name),
  UNIQUE (league_id, order_index)
);

-- una sola squadra può essere la tua, per lega
CREATE UNIQUE INDEX idx_one_mine
  ON fanta_team (league_id) WHERE is_mine = 1;

CREATE TABLE purchase (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  league_id     INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  fanta_team_id INTEGER NOT NULL REFERENCES fanta_team(id) ON DELETE CASCADE,
  player_id     INTEGER NOT NULL REFERENCES player(id),
  price         INTEGER NOT NULL CHECK (price >= 0),
  slot_role     TEXT NOT NULL CHECK (slot_role IN ('P','D','C','A')),
  sequence      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_purchase_player ON purchase (league_id, player_id);
CREATE INDEX idx_purchase_team          ON purchase (fanta_team_id);
CREATE INDEX idx_purchase_sequence      ON purchase (league_id, sequence);

CREATE TABLE auction_log (
  id         INTEGER PRIMARY KEY,
  league_id  INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  phase      TEXT NOT NULL CHECK (phase IN ('auction','review')),
  action     TEXT NOT NULL,
  payload    TEXT NOT NULL,   -- JSON
  actor_uuid TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_log_league ON auction_log (league_id, created_at);

CREATE TABLE league_snapshot (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  league_id     INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  produced_by   TEXT NOT NULL,
  produced_role TEXT NOT NULL CHECK (produced_role IN ('admin','participant')),
  note          TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (league_id, version)
);

CREATE TABLE target (
  id        INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES player(id),
  tier      INTEGER CHECK (tier BETWEEN 1 AND 5),
  max_price INTEGER CHECK (max_price >= 0),
  rating    INTEGER CHECK (rating BETWEEN 1 AND 5),
  note      TEXT,
  priority  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (league_id, player_id)
);

CREATE TABLE plan (
  id         INTEGER PRIMARY KEY,
  league_id  INTEGER NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE plan_item (
  plan_id   INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES player(id),
  est_price INTEGER NOT NULL CHECK (est_price >= 0),
  slot_role TEXT NOT NULL CHECK (slot_role IN ('P','D','C','A')),
  PRIMARY KEY (plan_id, player_id)
);
```

`PRAGMA foreign_keys = ON` va impostato a ogni apertura: SQLite lo tiene disattivato di default e senza, metà dei vincoli qui sopra non esiste.

### Due trappole nello schema

**Il riordino delle squadre.** `UNIQUE (league_id, order_index)` è immediato in SQLite, non differibile. Scambiare due squadre con due `UPDATE` successivi fallisce sul primo. Il servizio deve riscrivere tutti gli indici in una transazione passando per valori temporanei negativi. Va scritto, altrimenti si "risolve" togliendo il vincolo.

**Undo con cancellazione vera.** L'undo fa un `DELETE` su `purchase` e scrive nel log. Un soft delete romperebbe l'indice unico su `(league_id, player_id)` e il giocatore annullato non sarebbe più riacquistabile.

---

## 5. Invarianti

Regole che il livello dati deve garantire, non l'interfaccia. Implementate nei servizi del main, dentro una transazione.

1. Un giocatore non può comparire in due `purchase` della stessa lega. *(indice unico)*
2. `price` non può superare i crediti residui della squadra acquirente.
3. Gli acquisti di una squadra per un ruolo non possono superare `league_slot.slots`.
4. **Completabilità**: dopo un acquisto i crediti residui devono restare almeno pari agli slot liberi per `min_bid`. Chi ha 20 crediti e 15 slot vuoti non può spenderne 19.
5. **Puntata massima** = `crediti_residui − (slot_liberi − 1) × min_bid`, con guardia: a `slot_liberi = 0` vale zero e la squadra sparisce dal selettore. Senza la guardia la formula restituirebbe `crediti + min_bid`.
6. `slot_role` di un acquisto deve coincidere con il `role_classic` del giocatore.
7. **Il giocatore di un acquisto deve appartenere alla stagione della lega.** `purchase.player_id → player.season_id` deve uguagliare `league.season_id`. Nulla nello schema lo impedisce, quindi lo impone il servizio.
8. Una lega passa a `auction` solo con almeno due squadre e gli slot configurati.
9. Una squadra si può cancellare solo negli stati `setup` e `pre_auction`. Dopo, la cascata cancellerebbe i suoi acquisti in silenzio.
10. Un import non può cancellare giocatori referenziati da acquisti, obiettivi o piani. Chi sparisce dal nuovo listone si marca con `delisted_at`, non si rimuove.
11. In `review` le invarianti 2, 3 e 4 **non bloccano**: vengono calcolate e segnalate. Le invarianti 1, 6 e 7 restano attive, perché sono errori strutturali e non di merito.
12. **Cambiare il giocatore di un acquisto in revisione ricalcola `slot_role`** dal nuovo `role_classic`, nella stessa transazione. Non è compito dell'interfaccia.
13. In `closed` nessuna scrittura su `purchase`, `fanta_team`, `league_slot`. L'unica transizione è la riapertura, registrata nel log.
14. Cristallizzare assegna `version = MAX(version) + 1`. Gli snapshot non si cancellano e non si sovrascrivono mai.
15. `content_hash` si calcola su una serializzazione canonica: chiavi ordinate, acquisti ordinati per `uuid`, numeri senza zeri decimali superflui. Due snapshot con lo stesso contenuto devono produrre lo stesso hash su macchine diverse.
16. `budget`, `min_bid`, `auction_format`, `mode`, `defense_modifier` e `league_slot` sono modificabili solo in `setup` e `pre_auction`. Da `auction` in poi sono di sola lettura, revisione compresa.
17. L'import di un dataset è bloccato negli stati `auction`, `review` e `closed`.

La 13 nomina tre tabelle e non ne sottintende altre: `target` e `plan` restano scrivibili anche a lega cristallizzata. Non è una svista — obiettivi e piani sono gli appunti di chi si preparava, non il risultato, e lo snapshot del §7 contiene soltanto `league`, `teams` e `purchases`, quindi modificarli non può contraddire nessun resoconto firmato.

**L'import di una sessione è l'eccezione dichiarata alla 13 e alla 14.** Riprendere una sessione da un file sostituisce la lega con lo stesso `uuid`: la cancella intera — acquisti, squadre e snapshot locali — e ne riscrive una identica al file, già `closed`, con la versione e l'impronta che il file porta. Non è una scrittura *dentro* una lega cristallizzata, è quella lega che smette di esserci. Le due invarianti proteggono un resoconto firmato dal cambiare sotto gli occhi di chi lo sta leggendo; un import è un gesto che nomina per esteso cosa toglie e fa un backup del database prima di toglierlo.

La 10 è quella che si dimentica sempre e che rompe il database a metà mercato. La 11 è quella che rende usabile la revisione: un'app che rifiuta la scrittura mentre stai correggendo un errore ti costringe a correggerlo altrove.

---

## 6. Valutazione dei giocatori

Le statistiche grezze stanno nel database. Il punteggio sintetico **si calcola nell'app**, perché i pesi devono essere modificabili: chi gioca col modificatore di difesa valuta i difensori in modo diverso da chi non lo usa.

Le giornate di campionato sono **38**, costante nominata, non un numero sparso nel codice.

| Campo | Formula | Fonte | A cosa serve |
|---|---|---|---|
| `bonus_index` | `FM − MV` | Fantacalcio | quanto porta bonus oltre al voto |
| `reliability` | `Pv / 38` | Fantacalcio | in quante giornate ti ha davvero reso |
| `malus_rate` | `(gialli + rossi×2 + autogol) / Pv` | Fantacalcio | rischio malus |
| `conceded_per_match` | `Gs / Pv` | Fantacalcio | portieri, utile col modificatore |
| `start_share` | `Starts / MP` | FBref | titolare o subentrante |
| `minutes_per_match` | `Min / MP` | FBref | quanto sta in campo quando gioca |
| `clean_sheet_rate` | `CS / Starts` | FBref | portieri |
| `convenience` | `score / quotazione` | derivato | rapporto qualità-prezzo, con guardia sullo zero |

Le ultime tre esistono solo se lo stadio FBref è stato eseguito. L'interfaccia le nasconde invece di mostrare colonne vuote, leggendo `season.has_fbref`.

`reliability` penalizza chi è arrivato a gennaio. È un limite noto e va annotato nella scheda giocatore, non nascosto.

Punteggio sintetico configurabile per lega:

```
score = w1·FM_attesa + w2·reliability + w3·bonus_index
      + w4·start_share − w5·malus_rate
```

I pesi stanno in `league.scoring_weights` come JSON. I predefiniti sono differenziati per ruolo: per i portieri conta la MV pura e, col modificatore attivo, `conceded_per_match`; per gli attaccanti il `bonus_index`.

Il **prezzo atteso** normalizza lo `score` sulla distribuzione dei crediti disponibili per ruolo. Non è una previsione, è un riferimento per costruire le fasce.

---

## 7. Formato dello snapshot

Il contratto che dovrà reggere la riconciliazione futura.

```json
{
  "format": "fanta-help/league-snapshot",
  "formatVersion": 1,
  "producedBy": {
    "instanceUuid": "9f2c…",
    "label": "PC di Edoardo",
    "role": "admin"
  },
  "snapshot": {
    "uuid": "4b81…",
    "version": 1,
    "createdAt": 1725100000000,
    "contentHash": "sha256:a91f…"
  },
  "league": {
    "uuid": "1d47…",
    "name": "Lega degli Amici",
    "seasonId": "2026-27",
    "mode": "classic",
    "auctionFormat": "call",
    "budget": 500,
    "minBid": 1,
    "defenseModifier": false,
    "slots": { "P": 3, "D": 8, "C": 8, "A": 6 }
  },
  "teams": [
    { "uuid": "aa01…", "name": "Real Fanta", "manager": "Edoardo", "orderIndex": 0 }
  ],
  "purchases": [
    {
      "uuid": "cc19…",
      "teamUuid": "aa01…",
      "playerIdentityKey": "fc-2170",
      "playerName": "Lautaro Martinez",
      "playerTeam": "Inter",
      "price": 47,
      "slotRole": "A"
    }
  ]
}
```

**Il nome del giocatore è denormalizzato apposta.** `playerIdentityKey` basterebbe per un'app con lo stesso dataset, ma il file deve restare leggibile da chi lo apre senza avere il listone, e reggere se il listone nel frattempo è cambiato.

**`createdAt` è in millisecondi**, come ogni `created_at` e `updated_at` dello schema. L'unità va detta perché il file la congela: `formatVersion` non cambia per un'aggiunta, ma un lettore che la sbaglia di mille legge il 1970 e non se ne accorge, perché una data assurda in un campo che nessuno guarda non rompe niente. Un secondo formato di tempo solo qui sarebbe la conversione che si ricorda scrivendo e si dimentica leggendo.

**Niente id numerici, solo UUID.** Un id locale in un file di scambio sembra funzionare finché non si importa su una macchina dove quel numero è già occupato.

**`contentHash` copre solo `league`, `teams` e `purchases`**, non i metadati di produzione. Così due istanze che hanno registrato la stessa asta producono lo stesso hash anche se firmato da persone diverse, e il confronto si riduce a un uguale o diverso.

Nessuna firma crittografica in v1. Un hash dice se il contenuto è cambiato, non chi l'ha prodotto, e per un gruppo di amici basta.

---

## 8. Decisioni chiuse

Tutti i punti aperti dei documenti precedenti hanno una risposta.

| Questione | Decisione |
|---|---|
| Formato della chiave di identità | `fc-<sourceId>`, generabile anche da un import XLSX |
| Formato del dataset | JSON compresso, non SQLite già pronto |
| Stagioni di storico | tre |
| Repo del dataset | `edocico/fanta-help-dataset`, privata |
| Date di nascita | pubblicate nel dataset |
| Rigoristi designati | nel dataset, derivati e sovrascrivibili a mano |
| Firma crittografica degli snapshot | no in v1, basta l'hash |
| Nome delle presenze | `matches_rated` internamente, `Pv` nell'interfaccia |
| Modificatore di difesa | flag configurabile sulla lega, predefinito spento |
| Pesi del punteggio | colonna JSON su `league` |
| ORM | Drizzle, per le migrazioni |
| xG e xA | fuori dalla v1, la fonte non esiste più |

---

## Riferimenti

- Documento 2: flussi e schermate
- Documento 3: architettura
- Documento 4: pipeline dati
