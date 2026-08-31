# Fanta-Help — Documento 3: Architettura

> Input: documenti 1 (modello dati) e 2 (flussi e schermate).
> Output: base per il documento 4 (pipeline dati) e per le istruzioni a Claude Code.

---

## 1. Le tre regole che decidono tutto il resto

**Il database vive solo nel processo main.** Il renderer non conosce SQLite, non importa Drizzle, non sa che esiste un file .db. Parla soltanto con un'API tipizzata.

**Le invarianti stanno nei servizi del main, non nell'interfaccia.** L'interfaccia disabilita il bottone perché è scortese lasciar premere qualcosa che fallirà, ma il servizio rivalida sempre. Un componente React con un bug non deve poter corrompere i dati.

**Ogni tipo è definito una volta sola, in `src/shared`.** Se un canale IPC cambia forma, TypeScript rompe la compilazione su entrambi i lati nello stesso momento. È l'unico modo per non passare la serata a debuggare un `undefined` arrivato da un altro processo.

---

## 2. Struttura del repository

```
fanta-help/
├── electron.vite.config.ts
├── electron-builder.yml
├── drizzle.config.ts
├── components.json                 shadcn/ui
├── tsconfig.json
├── tsconfig.node.json              main + preload
├── tsconfig.web.json               renderer
├── vitest.config.ts                i test, documento 6
├── drizzle/                        migrazioni generate, spedite come risorsa
├── resources/                      icone applicazione
└── src/
    ├── main/
    │   ├── index.ts                bootstrap, finestra, ciclo di vita
    │   ├── db/
    │   │   ├── client.ts           connessione, pragma, backup
    │   │   ├── schema.ts           schema Drizzle
    │   │   └── migrate.ts
    │   ├── services/               logica di dominio, qui vivono le invarianti
    │   │   ├── dataset.ts          download, import XLSX
    │   │   ├── availability.ts     dati vivi, cache degli infortuni
    │   │   ├── update.ts           electron-updater
    │   │   ├── league.ts
    │   │   ├── team.ts
    │   │   ├── player.ts
    │   │   ├── auction.ts
    │   │   ├── review.ts
    │   │   ├── snapshot.ts
    │   │   ├── target.ts
    │   │   └── plan.ts
    │   ├── http/
    │   │   └── client.ts           wrapper su fetch nativo: timeout, retry, errori
    │   ├── ipc/
    │   │   ├── handlers.ts         mappa canale → funzione, senza importare electron
    │   │   ├── register.ts         aggancia gli handler a ipcMain, con validazione
    │   │   └── coverage.test.ts    contratti e handler devono coincidere
    │   └── export/
    │       ├── xlsx.ts
    │       └── json.ts
    ├── preload/
    │   └── index.ts                contextBridge, nient'altro
    ├── shared/                     importato da main e renderer
    │   ├── contracts.ts            mappa canale → schema input/output
    │   ├── types.ts                DTO derivati dagli schemi
    │   ├── errors.ts               codici errore e messaggi italiani
    │   └── domain.ts               ruoli, calcoli puri, costanti
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── lib/
            │   ├── ipc.ts          wrapper tipizzato su window.api
            │   └── query.ts        client TanStack Query
            ├── routes/
            ├── features/           un cartella per dominio
            │   ├── players/
            │   ├── league/
            │   ├── targets/
            │   ├── plans/
            │   ├── auction/
            │   └── review/
            ├── components/
            │   └── ui/             componenti shadcn generati
            ├── stores/             zustand
            └── styles/
```

`src/shared` è la spina dorsale. Non importa mai da `main` né da `renderer`, solo il contrario. Non contiene niente che dipenda da Node o dal DOM, così può essere compilato per entrambi i target.

---

## 3. Il contratto IPC

### Perché non tRPC

La ricerca segnalava `electron-trpc` come opzione per la type safety end-to-end. Lo scarto: la superficie di questa app è di una quarantina di canali, tutti richiesta-risposta, nessuna sottoscrizione complessa. tRPC aggiungerebbe due livelli di astrazione e un overhead a runtime per risolvere un problema che una mappa tipizzata risolve in cinquanta righe.

Restano i vantaggi che contano: tipi condivisi, validazione a runtime, errori uniformi.

### La mappa

```ts
// src/shared/contracts.ts
import { z } from 'zod'

export const contracts = {
  'player.list': {
    input: z.object({
      seasonId: z.string(),
      leagueId: z.number().int().optional(),   // per marcare i già acquistati
      role: z.enum(['P', 'D', 'C', 'A']).optional(),
      mantraRole: z.string().optional(),
      serieATeamId: z.number().int().optional(),
      search: z.string().optional(),
    }),
    output: z.array(playerRow),
  },

  'auction.assign': {
    input: z.object({
      leagueId: z.number().int(),
      playerId: z.number().int(),
      fantaTeamId: z.number().int(),
      price: z.number().int().nonnegative(),
    }),
    output: auctionState,
  },

  'auction.undo': {
    input: z.object({ leagueId: z.number().int() }),
    output: auctionState,
  },

  'snapshot.freeze': {
    input: z.object({ leagueId: z.number().int(), note: z.string().optional() }),
    output: snapshotSummary,
  },

  // …
} as const satisfies ContractMap
```

I tipi si derivano, non si riscrivono:

```ts
export type Channel = keyof typeof contracts
export type Input<C extends Channel>  = z.infer<(typeof contracts)[C]['input']>
export type Output<C extends Channel> = z.infer<(typeof contracts)[C]['output']>
```

### I tre lati

**Preload** — espone due funzioni, e non sa niente dei canali:

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),

  subscribe: (topic: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(`event:${topic}`, listener)
    return () => { ipcRenderer.off(`event:${topic}`, listener) }
  },
})
```

`subscribe` serve per tutto ciò che il main deve spingere verso il renderer senza essere interrogato: l'avanzamento di un import, lo stato di un aggiornamento. Restituisce la funzione di disiscrizione, così un `useEffect` la può usare come cleanup e non si accumulano listener a ogni render.

I topic sono tipizzati come i canali, in una mappa parallela:

```ts
// src/shared/contracts.ts
export const events = {
  'dataset.progress': z.object({ done: z.number(), total: z.number(), label: z.string() }),
  'update.status': updateStatus,
} as const satisfies EventMap
```

**Renderer** — il wrapper riporta i tipi:

```ts
// src/renderer/src/lib/ipc.ts
import type { Channel, Input, Output } from '@shared/contracts'
import type { Result } from '@shared/errors'

export async function call<C extends Channel>(
  channel: C,
  input: Input<C>,
): Promise<Output<C>> {
  const res = (await window.api.invoke(channel, input)) as Result<Output<C>>
  if (!res.ok) throw new IpcError(res.error)
  return res.data
}
```

**Main** — la registrazione valida prima di chiamare il servizio:

```ts
// src/main/ipc/register.ts
export function register<C extends Channel>(
  channel: C,
  handler: (input: Input<C>) => Promise<Output<C>> | Output<C>,
) {
  ipcMain.handle(channel, async (_e, raw) => {
    const parsed = contracts[channel].input.safeParse(raw)
    if (!parsed.success) {
      return fail('BAD_INPUT', 'Richiesta non valida', parsed.error.flatten())
    }
    try {
      return ok(await handler(parsed.data as Input<C>))
    } catch (e) {
      return toResult(e)
    }
  })
}
```

Nessun canale può essere registrato senza esistere in `contracts`, e nessun canale può esistere in `contracts` senza avere un handler: un test di copertura confronta le due liste e fallisce se divergono.

### Errori

Involucro uniforme, mai eccezioni che attraversano il confine:

```ts
type Result<T> =
  | { ok: true;  data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } }
```

I codici sono la traduzione diretta della tabella dei casi limite del documento 2. Il messaggio italiano vive in `shared/errors.ts` accanto al codice, così non si sparpaglia nei componenti.

| Codice | Messaggio |
|---|---|
| `PLAYER_ALREADY_OWNED` | Già a {team} per {price} |
| `ROLE_SLOTS_FULL` | {team} ha già {n} {ruolo} |
| `INSUFFICIENT_CREDITS` | {team} ha {n} crediti |
| `EXCEEDS_MAX_BID` | {team} può arrivare a {max}: deve tenere {n} crediti per gli slot rimasti |
| `BELOW_MIN_BID` | La puntata minima è {n} |
| `LEAGUE_FROZEN` | Il resoconto è cristallizzato. Riaprilo per modificarlo. |
| `RULES_LOCKED` | Il regolamento si blocca quando parte l'asta. |
| `DATASET_LOCKED` | Non puoi aggiornare il listone durante un'asta. |

### I canali

Una quarantina, raggruppati per prefisso.

```
app.instance          app.settings.get      app.settings.set
dataset.status        dataset.download      dataset.importXlsx     dataset.list
league.list           league.get            league.create          league.update
league.delete         league.setStatus
team.list             team.create           team.update            team.delete
team.reorder
player.list           player.get            player.stats
target.list           target.upsert         target.delete
plan.list             plan.get              plan.create            plan.delete
plan.addItem          plan.removeItem
auction.start         auction.close         auction.state          auction.assign
auction.undo          auction.setTurn       auction.history
review.issues         review.updatePurchase review.deletePurchase  review.addPurchase
snapshot.list         snapshot.get          snapshot.freeze        snapshot.reopen
availability.list     availability.refresh  availability.status
export.xlsx           export.json           export.importJson
update.check          update.download       update.install
```

**Le transizioni di stato hanno canali propri.** `auction.start` e `auction.close` non sono un `league.setStatus` generico, perché ognuna porta effetti collaterali diversi: la prima blocca il regolamento e il reimport del listone, la seconda calcola le anomalie e apre la revisione. Un canale generico li nasconderebbe dietro un aggiornamento di campo.

`auction.assign` e `auction.undo` restituiscono l'intero stato d'asta aggiornato, non solo la riga toccata. Costa qualche kilobyte e toglie di mezzo una categoria di bug da stato disallineato.

---

## 4. Stato nel renderer

Due strumenti, con un criterio netto per scegliere.

**TanStack Query** per tutto ciò che arriva dal main. La `queryKey` rispecchia canale e input:

```ts
useQuery({
  queryKey: ['player.list', { seasonId, leagueId, role }],
  queryFn: () => call('player.list', { seasonId, leagueId, role }),
  staleTime: Infinity,   // i giocatori cambiano solo a un import
})
```

**Zustand** per lo stato effimero dell'interfaccia: il rilancio in corso, i filtri attivi, il pannello aperto, il modo proiezione.

La regola per non sbagliare: **niente che debba sopravvivere a un riavvio sta in Zustand**. Se dopo una chiusura accidentale quel dato deve esserci ancora, allora è del main.

### Il caso dell'asta

Lo store dell'asta contiene giocatore selezionato, prezzo digitato, squadra scelta, passo corrente del flusso. Alla conferma parte la mutazione, che invalida `auction.state` e `player.list`. Se la mutazione fallisce lo store resta com'è, così puoi correggere il prezzo senza ridigitare il nome.

### La ricerca

I circa 600 giocatori si caricano una volta per stagione e restano in memoria nel renderer. La ricerca durante l'asta gira lì, con **uFuzzy**, e risponde in meno di un millisecondo.

L'FTS5 del database serve per le query fatte dal main, non per il campo di ricerca dell'asta. Un giro di IPC a ogni tasto sarebbe più lento di quanto serve, e questa è l'unica interazione dove la latenza si nota davvero.

---

## 5. Il livello dati

### Connessione

```ts
// src/main/db/client.ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'

const file = join(app.getPath('userData'), 'fanta-help.db')
const sqlite = new Database(file)

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')     // SQLite lo tiene spento di default
sqlite.pragma('synchronous = NORMAL')

export const db = drizzle(sqlite, { schema })
```

`foreign_keys = ON` va impostato a ogni apertura, non è persistente. Senza, metà dei vincoli del documento 1 non esistono.

### Migrazioni

Il problema noto: con un percorso relativo, in un'app pacchettizzata la cartella delle migrazioni finisce dentro `app.asar` e Drizzle non la trova, con un errore su `meta/_journal.json`.

```ts
const migrationsFolder = app.isPackaged
  ? join(process.resourcesPath, 'drizzle')
  : join(app.getAppPath(), 'drizzle')

migrate(db, { migrationsFolder })
```

e in `electron-builder.yml` la cartella va spedita come risorsa esterna, non impacchettata.

### Transazioni

Ogni scrittura che tocca più tabelle sta in una transazione. `auction.assign` è l'esempio canonico:

```ts
export const assign = db.transaction((input: AssignInput) => {
  const league = requireLeague(input.leagueId)
  assertStatus(league, 'auction')
  assertPlayerAvailable(league, input.playerId)
  assertSlotFree(league, input.fantaTeamId, player.roleClassic)
  assertAffordable(league, input.fantaTeamId, input.price)   // include la puntata massima

  const purchase = insertPurchase(...)
  insertLog('auction', 'purchase.create', purchase)
  if (league.auctionFormat === 'draft') advanceTurn(league)

  return buildAuctionState(league.id)
})
```

Le `assert` sono le invarianti del documento 1. Vivono qui e in nessun altro posto.

In stato `review` valgono le stesse funzioni ma con un flag che declassa le violazioni di merito da errore a segnalazione, come da invariante 11. Non sono due implementazioni: è la stessa, con la severità come parametro.

### La trappola del riordino

`fanta_team` ha `UNIQUE (league_id, order_index)`, e in SQLite i vincoli di unicità sono **immediati, non differibili**. Scambiare due squadre di posto con due `UPDATE` successivi fallisce sul primo, perché a metà operazione due righe condividono lo stesso indice.

```ts
export const reorder = db.transaction((leagueId: number, orderedIds: number[]) => {
  // 1. sposta tutti fuori dallo spazio dei valori validi
  for (const [i, id] of orderedIds.entries()) setOrderIndex(id, -(i + 1))
  // 2. riscrivi gli indici definitivi
  for (const [i, id] of orderedIds.entries()) setOrderIndex(id, i)
})
```

Va scritto qui perché senza indicazione la soluzione istintiva è togliere il vincolo, e il vincolo serve.

### Cambiare giocatore in revisione

Sostituire il giocatore di un acquisto tocca due invarianti insieme: l'unicità nella lega e la corrispondenza tra `slot_role` e `role_classic`. Il servizio **ricalcola `slot_role` dal nuovo giocatore nella stessa transazione**. Non è compito dell'interfaccia passare il valore giusto.

### Backup

Prima di ogni import di dataset e prima di ogni cristallizzazione, il file del database viene copiato in `userData/backups/` con un timestamp nel nome. Il database pesa pochi megabyte, il costo è nullo, e copre il caso in cui un import fatto male rovini una lega a metà mercato.

Si conservano gli **ultimi dieci**. Senza una politica di rotazione la cartella cresce per sempre, e su un'app usata per anni diventa qualche gigabyte che nessuno guarderà mai.

### Lo strato dei dati vivi

L'unico punto in cui l'app parla con la rete durante l'uso normale, e va isolato di conseguenza.

Il servizio `availability` chiama API-Football dal main, mappa la risposta ai nostri giocatori tramite `player_external_id` — **per identificativo, mai per nome** — e scrive in `player_availability` con un timestamp.

```ts
// la ricerca che rende deterministico l'aggancio
const stmt = db.prepare(`
  SELECT player_id FROM player_external_id
  WHERE source = 'apiFootball' AND external_id = ?
`)
```

L'indice su `(source, external_id)` del documento 1 esiste per questa query.

Regole non negoziabili:

- **Il renderer non legge mai dalla rete.** Interroga `availability.list`, che risponde dalla cache anche quando la cache è vecchia o vuota.
- **Nessuna chiamata di rete blocca niente.** Un fallimento aggiorna lo stato del servizio e non produce un errore visibile durante l'asta.
- **Refresh non più di una volta l'ora**, mai in ciclo automatico. Una richiesta copre tutti gli indisponibili della Serie A, quindi anche l'uso più aggressivo resta ampiamente dentro le cento richieste giornaliere del piano gratuito.
- **La chiave si conserva con `safeStorage`** di Electron, cifrata a riposo, non in chiaro nella configurazione.

Se manca la chiave, manca la rete o il dataset non ha gli identificativi esterni, lo strato è semplicemente assente e tutto il resto funziona identico.

---

## 6. Sicurezza

```ts
new BrowserWindow({
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
```

- Nessun modulo Node esposto al renderer, solo `window.api.invoke`.
- Content-Security-Policy restrittiva nel renderer, senza `unsafe-eval`.
- I link esterni si aprono nel browser di sistema con `shell.openExternal`, con una lista di domini ammessi.
- Il download del dataset accetta solo l'host configurato, non un URL arbitrario.
- **L'import XLSX è l'unico punto in cui entra un file non controllato.** Il parsing avviene nel main con SheetJS, ogni riga passa per uno schema zod, e un file malformato viene rifiutato per intero invece di essere importato a metà.

### I due segreti

L'app ne maneggia due, con provenienza e trattamento diversi.

**Il token della repo del dataset.** Iniettato in fase di build da una variabile d'ambiente, **mai scritto nel sorgente**: la repo dell'app è pubblica, e un token committato lì viene revocato da GitHub in pochi minuti. Fine-grained, sola lettura, valido solo su `fanta-help-dataset`. Se non funziona, l'app lo dice una volta e passa all'import XLSX senza riprovare a ogni avvio.

**La chiave di API-Football.** La mette l'utente nelle impostazioni, con un valore predefinito iniettato in build. Si conserva con `safeStorage`, cifrata a riposo.

Entrambi restano estraibili da chi ha il pacchetto. Non sono segreti veri, sono serrature sulla porta di casa di amici, e sono progettati perché il danno di un'estrazione sia nullo: sola lettura su una repo, o cento richieste al giorno di un piano gratuito.

---

## 7. Build e packaging

### electron-vite

```ts
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],   // lascia fuori better-sqlite3
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
  },
})
```

`externalizeDepsPlugin()` è quello che impedisce al bundler di tentare di impacchettare il modulo nativo. Senza, la build fallisce in modo poco leggibile.

### electron-builder

```yaml
# electron-builder.yml
appId: it.fantahelp.app
productName: Fanta Help
directories:
  output: release
  buildResources: resources

files:
  - out/**
  - package.json

extraResources:
  - from: drizzle
    to: drizzle

asar: true
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/bindings/**"
  - "**/node_modules/file-uri-to-path/**"

npmRebuild: true

win:
  target:
    - target: nsis
      arch: [x64, arm64]
mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  category: public.app-category.sports
linux:
  target:
    - target: AppImage
      arch: [x64, arm64]
    - target: deb
      arch: [x64, arm64]
  category: Sports
```

Le tre voci in `asarUnpack` sono tutte necessarie: `better-sqlite3` carica il proprio binario tramite `bindings`, che a sua volta usa `file-uri-to-path`. Se ne manca una, l'app parte in sviluppo e crolla in produzione.

**Le architetture vanno scritte a mano.** Senza `arch`, electron-builder costruisce solo per quella della macchina che lo lancia: da un Mac Apple Silicon uscirebbero installer Windows e Linux arm64, senza un errore e senza un avviso. Servono x64 e arm64 su tutte e tre le piattaforme. Verificato in T1: i binari precompilati di `better-sqlite3` esistono per tutte le combinazioni, quindi `npmRebuild` li risolve senza toolchain di cross-compilazione.

`author` con un indirizzo email è obbligatorio, altrimenti il target `deb` si ferma: fpm rifiuta di produrre un pacchetto senza campo *maintainer*. Serve anche `homepage`, che senza `repository` in `package.json` viene dedotto dal remote git e sparisce in un export senza `.git`.

In `package.json`:

```json
"scripts": {
  "postinstall": "electron-builder install-app-deps",
  "rebuild": "electron-rebuild -f -w better-sqlite3"
}
```

### Rischi noti

**Il modulo nativo.** È il punto di rottura più probabile del progetto. La ricerca segnalava una regressione in electron-builder 25.0.5 sul packaging dei moduli nativi, risolta tornando a 24.13.3. Va fissata una versione verificata, e **la prima cosa da fare dopo lo scaffolding è produrre un pacchetto vuoto ma funzionante su tutti e tre i sistemi**, prima di scrivere una riga di logica. Scoprire il problema a progetto avanzato costa molto di più.

Se il rebuild nativo dovesse rivelarsi insostenibile su qualche piattaforma, il piano B è `node-sqlite3-wasm`: più lento, ma su seicento righe la differenza non si percepisce, e non richiede toolchain di compilazione.

**Firma e notarizzazione.** Vedi la sezione seguente: non è più solo una questione di avvisi all'avvio, perché l'aggiornamento automatico su macOS dipende dalla firma.

---

## 8. Aggiornamento dell'applicazione

Entra nella v1. Cambia poco nell'architettura e parecchio nel packaging.

### Il meccanismo

`electron-updater` con provider GitHub sulle Release della repo pubblica `edocico/fanta-help`. Nessun server, nessun costo, nessuna autenticazione: le Release di una repo pubblica si leggono senza token.

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: edocico
  repo: fanta-help
```

Pubblicare una versione diventa: alzare il numero in `package.json`, eseguire la build, caricare gli artefatti come Release. Da lì in poi le installazioni esistenti se ne accorgono da sole.

### Il flusso nell'app

Il main incapsula `electron-updater` in un servizio che espone tre canali e trasmette il proprio stato sul topic `update.status`:

```ts
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available';   version: string; notes?: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready';       version: string }
  | { state: 'none' }
  | { state: 'manual';      version: string; url: string }   // solo macOS non firmato
  | { state: 'error';       message: string }
```

Il controllo parte all'avvio, in ritardo di qualche secondo per non rallentare l'apertura, e si può ripetere a mano dalle impostazioni. **Il download non è mai automatico**: l'app dice che c'è una versione nuova e aspetta. Scaricare centoventi megabyte senza chiedere, magari mentre qualcuno sta preparando l'asta in tethering, è un'invasione.

Installare richiede il riavvio, quindi il servizio rifiuta l'installazione se una lega è in stato `auction`. Il messaggio lo spiega invece di limitarsi a non funzionare.

### Il nodo di macOS

Qui c'è una scelta che costa soldi e va fatta consapevolmente.

Su **Windows e Linux** l'aggiornamento automatico funziona anche senza firma. L'installer NSIS mostra l'avviso SmartScreen la prima volta e basta.

Su **macOS no.** Il meccanismo di aggiornamento verifica la firma del pacchetto sostitutivo, e su un'app non firmata l'operazione fallisce. Non è aggirabile con trucchi: o l'app è firmata e notarizzata, o su Mac l'aggiornamento automatico non esiste.

Due strade, e l'architettura le supporta entrambe senza modifiche:

**Senza spendere.** Su macOS il servizio entra nello stato `manual`: l'app rileva la nuova versione, lo dice nell'interfaccia esattamente come sugli altri sistemi, ma il bottone apre la pagina della Release nel browser invece di scaricare in proprio. L'utente scarica il DMG e sostituisce l'app. È un clic in più e un trascinamento, non un'esperienza rotta.

**Spendendo.** Iscrizione all'Apple Developer Program, 99 dollari l'anno, che copre firma e notarizzazione senza costi aggiuntivi. Da quel momento macOS si comporta come gli altri due sistemi, e l'unica differenza è nella configurazione di build.

**Per la v1 la strada è la prima, ed è una decisione presa: nessun certificato Apple.** Su macOS l'app rileva la nuova versione e apre la pagina di download. Resta reversibile in qualsiasi momento: se il certificato dovesse arrivare, si aggiunge la firma alla configurazione di electron-builder e lo stato `manual` smette di verificarsi. Nessuna riga di logica applicativa da riscrivere.

Va scritto nelle istruzioni di installazione per Mac che la prima apertura richiede il tasto destro e "Apri", perché senza firma Gatekeeper blocca il doppio clic. È l'unico attrito, e capita una volta sola.

---

## 9. Qualità

> **Sostituita dal documento 6.** Quello che segue resta come sintesi; la suite di
> test, la trappola dell'ABI, il guardrail e la configurazione stanno in
> `06-testing.md`, scritto dopo. In caso di disaccordo vince il documento 6.

Poco e mirato, perché è un progetto di una persona.

- **Test unitari sui servizi del main**, in particolare sulle cinque invarianti e sul calcolo della puntata massima. Sono la parte dove un errore rovina una serata.
- **Un test sulla serializzazione canonica dello snapshot**, che verifica che lo stesso contenuto produca lo stesso hash con le chiavi in ordine diverso. Se questo si rompe, si rompe silenziosamente e ce ne si accorge fra un anno.
- **Il test di copertura dei canali** citato sopra.
- Niente test sull'interfaccia in v1.

---

## 10. Decisioni chiuse

| Questione | Decisione |
|---|---|
| ORM | **Drizzle**, per le migrazioni: lo schema evolverà tra una stagione e l'altra |
| Pesi del punteggio | colonna JSON su `league`, si leggono e si scrivono insieme al resto |
| Client HTTP | `fetch` nativo con un wrapper, niente axios |
| Transizioni di stato | canali espliciti, non un `setStatus` generico |
| Conservazione backup | ultimi dieci |
| Formato dataset | JSON compresso: l'import legge e inserisce, non allega un file SQLite |
| Firma macOS | **nessun certificato Apple.** Su Mac l'aggiornamento apre la pagina di download |

Non resta nessun punto aperto.

---

## Prossimo passo

Documento 4: pipeline dati. Formato del dataset, script di generazione, riconciliazione tra stagioni, import XLSX, versionamento.
