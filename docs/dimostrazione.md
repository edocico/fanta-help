# Dimostrazione — i comandi

Non è una specifica. È il foglio da tenere aperto la sera che l'app si mostra a
qualcuno: cosa lanciare, in che ordine, e cosa fare quando non parte.

Scritto il **2 settembre 2026** su questa macchina, Fedora 44 x64. I §1, §5 e §6
li ho eseguiti davvero, e le righe che stampano vengono da lì. Gli altri comandi
vengono da `package.json`, dagli script del progetto e dalle trappole già
registrate nel `CLAUDE.md`: esistono, ma non li ho rilanciati stasera.

---

## 1. Il percorso corto

L'app è già costruita e il database di sviluppo è già pieno. Quattro righe:

```bash
cd ~/Code/fanta-help
DEMO=~/demo-fanta
rm -rf "$DEMO" && cp -R ~/.config/"Fanta Help (dev)" "$DEMO"
env -u ELECTRON_RUN_AS_NODE "release/Fanta Help-0.0.0.AppImage" \
  --appimage-extract-and-run --user-data-dir="$DEMO"
```

Le tre cose che quelle righe evitano, tutte già costate tempo:

- **`env -u ELECTRON_RUN_AS_NODE`** — VS Code esporta quella variabile nei suoi
  terminali. Lasciata impostata, Electron esegue il main come Node normale e
  l'app muore con codice 0 e stderr vuoto.
- **`--appimage-extract-and-run`** — su Fedora manca FUSE2 e l'AppImage non si
  monta.
- **la copia** — gli stati della lega vanno solo avanti (`pre_auction` →
  `auction` → `review` → `closed`). Aprire un'asta per mostrarla brucia la lega
  vera. Sulla copia si può aprire, sbagliare, ricominciare.

`--user-data-dir` sull'app impacchettata punta esattamente alla cartella che
gli dai. **In sviluppo no**: `src/main/index.ts` aggiunge ` (dev)` in coda, quindi
lì la copia va messa in `<cartella> (dev)` e alla riga di comando si passa
`<cartella>`. Sbagliando, l'app parte su un database nuovo e vuoto e sembra che la
copia non sia riuscita.

---

## 2. Cosa c'è su questa macchina, oggi

Verificato leggendo i due database in sola lettura.

| Dove | Cosa contiene |
|---|---|
| `~/.config/Fanta Help (dev)` — **sviluppo** | 524 giocatori, statistiche di 4 stagioni (2023-24 → 2026-27), 20 squadre di Serie A, 3 leghe |
| `~/.config/Fanta Help` — **app installata** | 524 giocatori ma **nessuna statistica** (seminato da XLSX), nessuna lega |
| `release/Fanta Help-0.0.0.AppImage` | pacchetto del 1° settembre, 118 MB |
| `tools/dataset/output/2026-27/v1.json.gz` | dataset già costruito, col rapporto accanto in `v1.txt` |
| `tools/dataset/input/` | gli otto listoni XLSX, quotazioni e statistiche dal 2023-24 al 2026-27 |

Le tre leghe di sviluppo:

| Lega | Stato | Squadre | Dentro |
|---|---|---|---|
| Fanta fotta | **asta in corso** | 3 | 1 acquisto, 4 obiettivi |
| Lega degli amici | pronta per l'asta | 2 | — |
| Lega dell'ufficio | pronta per l'asta (draft a turni) | 2 | — |

Nessuna lega ha piani. Se la dimostrazione deve mostrare i piani, vanno creati
prima — sulla copia.

**Il database dell'app installata non è adatto a una dimostrazione**: senza
statistiche il dettaglio giocatore è mezzo vuoto e non c'è niente da confrontare.
O si parte dalla copia di sviluppo (§1), o si importa il dataset (§5).

---

## 3. Un'ora prima: i controlli

```bash
cd ~/Code/fanta-help
git status                 # niente in sospeso che possa sorprendere
npm run typecheck
npm test
```

Il modulo nativo, che è il pezzo che si rompe per primo. `require` da solo riesce
**anche con l'ABI sbagliata**: bisogna istanziare, e sotto l'ABI di Electron.

```bash
ELECTRON_RUN_AS_NODE=1 "node_modules/electron/dist/$(cat node_modules/electron/path.txt)" \
  -e "new (require('better-sqlite3'))(':memory:'); console.log('ABI ok')"
```

Se `node_modules` è monco — dopo un `pull` dall'altra macchina, per esempio —
prima di tutto il resto:

```bash
npm ci
npx electron-builder install-app-deps
```

Ricostruire il pacchetto solo se il codice è cambiato dal 1° settembre. Su questa
macchina **solo x64**: l'`electron-builder.yml` chiede anche arm64, e quella build
ricompila `better-sqlite3` per l'architettura sbagliata e ce la lascia.

```bash
npm run build
npx electron-builder --linux AppImage --x64
```

In pipe il codice di uscita è quello di `tail`, non della build: le righe che
contano sono quelle marcate `⨯`.

---

## 4. Il dataset, se va rifatto

Non serve per la dimostrazione — è già costruito. Serve solo se cambiano i
listoni.

```bash
ls tools/dataset/input/          # gli XLSX devono essere lì, scaricati a mano
npm run dataset:build            # [-- --season 2026-27] [--version v2] [--note "…"]
cat tools/dataset/output/2026-27/v1.txt   # il rapporto: leggilo prima del dataset
```

Lo script **si rifiuta di scrivere** ed esce con 1 se resta un'identità da
decidere: si risolve in `tools/dataset/overrides.json`, e la decisione
sopravvive a ogni rigenerazione.

---

## 5. Partire da un database vuoto

Serve se vuoi mostrare l'app come la vede chi la installa per la prima volta, o
se la copia di §1 non è disponibile.

```bash
DEMO=~/demo-vuoto
rm -rf "$DEMO" && mkdir -p "$DEMO"
cd ~/Code/fanta-help
env -u ELECTRON_RUN_AS_NODE "release/Fanta Help-0.0.0.AppImage" \
  --appimage-extract-and-run --user-data-dir="$DEMO"
```

L'app si apre sull'onboarding dati: «Servono i giocatori», due strade affiancate.
Quella di sinistra — scaricare il listone — **non è ancora collegata** (è T7b, e
la schermata lo dice). Restano due modi di riempirlo:

**a. Il file XLSX, dall'interfaccia.** «Scegli un file» → `tools/dataset/input/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx`
→ conferma la stagione. Entra il listone e basta: le colonne di rendimento
restano vuote, e l'app lo dice. È la strada che ha riempito il database dell'app
installata — quello di §2 senza statistiche. *Non l'ho ripercorsa stasera.*

**b. Il dataset completo, dalla console.** Eseguito oggi, sul database vuoto. Nessuna vista chiama ancora
`dataset.import` — prende una cartella, ed è il buco che T7b chiude. Strumenti di
sviluppo (`Ctrl+Shift+I`, menu predefinito di Electron: il main non ne imposta
uno suo), scheda Console:

```js
await window.api.invoke('dataset.import', {
  dir: '/home/edoardocicognani/Code/fanta-help/tools/dataset/output'
})
```

Su un database vuoto risponde così, e il backup lo fa da sé:

```
{ ok: true, data: { seasonId: '2026-27', version: 'v1', added: 524,
                    teams: 20, stats: 1417, backup: '…/backups/fanta-help-….db' } }
```

Due cose che non si deducono leggendo il codice:

- **L'interfaccia non si accorge dell'import fatto dalla console.** Resta sulla
  schermata «Servono i giocatori» finché non ricarichi la finestra — `Ctrl+R`,
  dallo stesso menu predefinito.
- **Con un'asta aperta l'import è rifiutato.** Torna
  `{ ok: false, error: { code: 'DATASET_LOCKED', message: 'Non puoi aggiornare il listone durante un’asta.' } }`.
  Quindi: prima i dati, poi si apre l'asta. Mai il contrario.

---

## 6. Guardare dentro un database senza aprirlo

Su questa macchina non c'è il binario `sqlite3`. Si legge con l'ABI di Electron,
in sola lettura — si può fare anche con l'app aperta:

```bash
ELECTRON_RUN_AS_NODE=1 "node_modules/electron/dist/$(cat node_modules/electron/path.txt)" -e "
const db = new (require('better-sqlite3'))(process.env.HOME + '/.config/Fanta Help (dev)/fanta-help.db', { readonly: true });
console.log(db.prepare('select id, name, status from league').all());
console.log(db.prepare('select count(*) n from player').get());
console.log(db.prepare('select season_id, count(*) n from player_season_stat group by season_id').all());
"
```

Cambia il percorso per leggere la copia della dimostrazione o il database
dell'app installata.

---

## 7. Il copione

Le viste che esistono, nell'ordine in cui hanno senso:

| # | Dove | Cosa si mostra |
|---|---|---|
| 1 | **Giocatori** (`/giocatori`) | 524 giocatori, ricerca, filtri sempre visibili, lista virtualizzata |
| 2 | Riga → **dettaglio** | storico su quattro stagioni, il pannello si chiude con `Esc` |
| 3 | **Leghe** → una lega | squadre, budget, slot (3 portieri, 8 difensori, 8 centrocampisti, 6 attaccanti), regole |
| 4 | **Obiettivi** | i giocatori marcati, per fascia |
| 5 | **Piani** | vanno creati prima: oggi non ce n'è nessuno |
| 6 | **Asta** | la barra di assegnazione, la board delle rose, la cronologia |
| 7 | **Proiezione** (`Ctrl+P`) | la stessa asta ingrandita per il secondo schermo |

Attenzione a una cosa che si nota da sola: nella barra della lega ci sono anche
**Revisione** e **Resoconto**, e non si aprono. Sono segnate `ready: false` in
`AppShell.tsx` — arrivano con T16 e T17. Meglio dirlo prima che qualcuno ci
clicchi.

### La sequenza dell'asta

Il giro che vale la pena mostrare, perché è il motivo per cui l'app esiste: tre
`Invio` e il nome del giocatore, circa dieci tasti.

1. Digiti le prime lettere del nome. `↓` `↑` per scegliere.
2. `Invio` — il fuoco passa al prezzo.
3. Digiti il prezzo. `Invio` — il fuoco passa alla squadra, già precompilata con
   quella di turno.
4. `Invio` — l'acquisto è registrato, il fuoco torna alla ricerca vuota.

Il listone nomina **per cognome**, con un'abbreviazione del nome quando è
ambiguo — 89 nomi su 524. La ricerca cerca anche sul **nome per esteso**, quindi
`lauta` trova `Martinez L.`: ma quel nome arriva dallo stadio FBref, e per chi
quello stadio non ha agganciato resta solo il cognome. Il rapporto della pipeline
lo dice in una riga, `N nomi per esteso`. Se quella riga dice zero, o se al suo
posto il blocco FBref dice `non eseguito` — che è lo stato finché i CSV non
vengono scaricati — si cerca per cognome come prima, e vale la pena provare i nomi
che si vogliono usare **prima** della serata.

### Le scorciatoie che esistono davvero

Sono queste, e sono la stessa lista che l'app mostra premendo `?`.

| Tasto | Cosa fa |
|---|---|
| `Ctrl/Cmd+K` | vai alla ricerca |
| `/` | vai alla ricerca, fuori dai campi di testo |
| `↑` `↓` | naviga i risultati |
| `Invio` | conferma il passo corrente dell'assegnazione |
| `Esc` | chiude prima la cronologia, e solo al secondo colpo svuota l'inserimento |
| `Tab` / `Shift+Tab` | campo successivo o precedente |
| `1`–`9` | scegli la squadra n-esima, nel campo squadra |
| `Ctrl/Cmd+Z` | annulla l'ultimo acquisto |
| `Ctrl/Cmd+H` | cronologia delle operazioni |
| `Spazio` | espandi la rosa della squadra selezionata |
| `Ctrl/Cmd+P` | modo proiezione |
| `?` | il riferimento: scorciatoie e sigle |

In proiezione il pannello di assegnazione non c'è, quindi `/` e `Ctrl/Cmd+K`
riportano indietro invece di cercare, e `Ctrl/Cmd+H` esce dalla proiezione e apre
la cronologia. `Ctrl/Cmd+F` **non esiste**: i filtri della vista Giocatori sono
già visibili, e la riga è stata tolta dal riferimento apposta.

`F11` resta lo schermo intero di sistema — non è la proiezione.

### Sul secondo schermo

La finestra si apre a **900×620**. Prima di collegare il televisore, portala alla
dimensione vera e guarda quante squadre entrano: le taglie di questo layout,
calcolate a mente, sono uscite sbagliate ogni volta. Si misurano nell'app in
esecuzione, non si deducono.

---

## 8. Dopo

La copia si butta, l'originale non è stato toccato:

```bash
rm -rf ~/demo-fanta ~/demo-vuoto
```

I backup automatici dell'import stanno in `<userData>/backups/`, tenuti a dieci.

---

## 9. Se non parte

| Sintomo | Verifica | Rimedio |
|---|---|---|
| Muore subito, codice 0, stderr vuoto | `echo $ELECTRON_RUN_AS_NODE` | `env -u ELECTRON_RUN_AS_NODE …` |
| L'AppImage non parte | — | `--appimage-extract-and-run`: qui manca FUSE2 |
| `NODE_MODULE_VERSION mismatch` | la riga dell'ABI in §3 | `npx electron-builder install-app-deps` |
| Comando o import che non risolve | `git log --oneline -3` contro `ls node_modules` | `npm ci` e poi `install-app-deps` |
| Parte vuota: nessuna lega, nessun giocatore | il percorso in §6 | è la cartella sbagliata: in sviluppo il suffisso ` (dev)` |
| L'import dice `DATASET_LOCKED` | lo stato della lega, §6 | c'è un'asta aperta: importa su una copia senza aste |
| La lista sembra congelata sulle prime righe | la finestra è davanti? | è occlusa: niente eventi di scorrimento. Portala davanti |
| `.deb` che non si costruisce | — | `sudo dnf install libxcrypt-compat`. L'AppImage non ne ha bisogno |

**Chiudere l'app.** Con `--appimage-extract-and-run` il processo che vedi
lanciare non è quello che regge la finestra: uccidendo solo il primo, l'app resta
aperta. Succede davvero.

```bash
pgrep -af appimage_extracted        # trova i PID veri
kill <pid>                          # per PID, uno per uno
```

Mai `pkill -f <pattern>` da dentro Claude Code: il pattern combacia con la shell
che lo esegue, e la uccide.

---

## 10. Cosa non si può ancora mostrare

Il progetto è arrivato a T15. Fuori dalla portata di questa dimostrazione:

- **Scaricare il listone** dalla repo del dataset (T7b): il bottone c'è e dice
  che non è collegato.
- **Revisione** e **Resoconto** (T16, T17): nella barra, non navigabili.
- **Export e import di una sessione** (T18). Un database non viaggia da solo fra
  le due macchine: `userData` sta in posti diversi.
- **Infortuni e dati vivi** (T19), **aggiornamento dell'app** (T20),
  **impostazioni** (T21).
- Il **refactoring visivo** della fase 8: quello che si vede è il documento 2, non
  ancora il 7.
