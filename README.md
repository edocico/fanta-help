# Fanta Help

App desktop di supporto all'asta del fantacalcio di Serie A. Uso privato, un
gruppo di amici. Serve a **preparare** l'asta e a **registrarla dal vivo**: non
gestisce il campionato.

Electron + React + TypeScript · SQLite nel processo main · distribuita come
AppImage e `.deb` per Linux, `.dmg` per macOS, installer NSIS per Windows.

---

## Sviluppo

```bash
npm ci                    # e non `npm install`: il lockfile è la verità
npm run dev               # l'app, con ricarica a caldo
npm test                  # la suite (gira su Node, non tocca il database)
npm run typecheck         # i due progetti, main e renderer
npm run lint
```

Se `npm run dev` non parte, prova nell'ordine:

| sintomo | causa | rimedio |
|---|---|---|
| `Cannot read properties of undefined (reading 'isPackaged')` | VS Code esporta `ELECTRON_RUN_AS_NODE=1` nei suoi terminali, ed Electron esegue il main come Node normale | `env -u ELECTRON_RUN_AS_NODE npm run dev` |
| errore di header ELF, o `NODE_MODULE_VERSION` | una build di pacchetto per un'altra piattaforma ha lasciato `better-sqlite3` compilato per quella | `npx electron-builder install-app-deps` |
| moduli mancanti dopo un `pull` | un `pull` non porta `node_modules`, e mancano proprio le dipendenze aggiunte nel frattempo | `npm ci && npx electron-builder install-app-deps` |

Per **vedere davvero cosa disegna l'app** — leggere il DOM, misurare, guidarla —
c'è uno script che porta dentro le trappole d'avvio già pagate:

```bash
bash .claude/skills/prova-pacchetto/run.sh dev
```

### Il database

Sta in `userData`, che dipende da `productName`: in sviluppo è
`Fanta Help (dev)`, nell'app installata `Fanta Help`. Sono due database
diversi, ed è voluto.

**Il database non viaggia fra le macchine.** Per spostare una sessione si usa
l'export/import JSON dall'app, non una copia di file.

### I dati

Il listone e le statistiche si scaricano **a mano** e la pipeline legge file
locali — non ci sono scraper. `npm run dataset:build` produce il dataset dai
file in `tools/dataset/input/` (ignorati da git). Senza quel passo il database
di sviluppo ha le colonne di rendimento vuote, ed è normale.

---

## Rilascio

Una Release è: **gli artefatti** che la gente scarica, **più i `latest*.yml`**,
che sono il *feed* che l'app interroga per sapere se esiste una versione nuova.

> **Il feed non è la Release: è un file dentro la Release.** Gli artefatti
> l'updater li trova solo perché il feed li nomina, con nome e sha512. Una
> Release impeccabile senza `latest*.yml` non esiste, per l'app — e l'errore che
> ne esce parla di un file di canale, non di un aggiornamento.

### 1. Dichiara il peso dei commit

Un commit che vale più di una correzione lo dice con un **trailer**, in fondo al
messaggio, accanto a `Co-Authored-By:`:

```text
Release: minor
```

I valori sono `patch`, `minor`, `major`. Il soggetto resta prosa che spiega il
perché: qui non si usano prefissi `feat:`/`fix:`. Un commit senza trailer pesa
`patch`, che è il pavimento — non un default nascosto.

Te ne accorgi dopo? `git commit --amend` sull'ultimo, o il trailer su un commit
successivo: **vince il più alto dell'intervallo**, non l'ultimo.

Cosa uscirebbe adesso:

```bash
npm run release:bump -- --spiega
```

### 2. Alza la versione e spingi il tag

```bash
npm version minor          # scrive package.json, committa e crea il tag `v0.2.0`
git push && git push --tags
```

Il tag **deve** essere `v` più il numero di `package.json`. Non è una
convenzione estetica: `src/main/index.ts` costruisce da lì il link della
schermata macOS «Apri la pagina di download», e il primo job del workflow
**fallisce** se i due non combaciano. `npm version` usa già quel prefisso.

### 3. La CI fa il resto

`.github/workflows/release.yml`, quattro job in fila:

```text
verifica  →  bozza  →  pacchetti (×3)  →  pubblica
   │           │            │                 │
tag ==      crea UNA    linux · mac · win   controlla i 4 feed,
package     Release     un job per          poi toglie la bozza
.json,      in bozza    SISTEMA
lint,
typecheck,
test
```

Non serve nessun secret: `GITHUB_TOKEN` nasce con l'esecuzione e muore con lei.

**Perché un job per sistema e non per architettura.** Il suffisso di
architettura nel nome del file di canale esiste **solo su Linux**: `win-x64` e
`win-arm64` scrivono entrambi `latest.yml`, `mac-x64` e `mac-arm64` entrambi
`latest-mac.yml`. Due invocazioni separate non si sommano — la seconda prende un
422 «already exists», ed `electron-publish` lo converte in **DELETE dell'asset
omonimo** seguito da un nuovo caricamento. Il primo sparisce dal feed e nessun
passo diventa rosso. Su Windows è peggio ancora: il nome dell'installer NSIS non
contiene mai l'architettura, quindi due job caricherebbero due exe *diversi* con
lo stesso nome e il secondo distruggerebbe il binario del primo.

**Perché la Release nasce bozza.** Due ragioni, tutt'e due silenziose. La
creazione non è idempotente, quindi tre job in parallelo si contendono la
Release e il perdente muore. E su una Release **non** bozza più vecchia di **due
ore**, i caricamenti vengono *saltati con un avviso e il job esce verde*:
piattaforma mancante, nessun rosso. Una bozza salta quel controllo, e viene
promossa solo quando tutti e quattro i file di feed ci sono.

Su un ramo, `workflow_dispatch` fa la stessa cosa **senza pubblicare niente** e
conserva i pacchetti come artefatti: è la prova a vuoto.

### Se qualcosa va storto

| | |
|---|---|
| il job di pubblicazione dà **403** | Settings → Actions → General → Workflow permissions → «Read and write» |
| il job `pubblica` dice **feed incompleto** | un sistema non ha pubblicato. La Release **resta in bozza**: guarda quale job è fallito, correggi, rilancia |
| vuoi rifare tutto | cancella la Release in bozza e il tag, poi rispingi il tag |

### La via manuale, quando la CI non serve

Da Fedora si costruiscono **Linux e Windows** (quest'ultimo grazie a wine);
macOS no, serve il Mac. La procedura completa, con le trappole, sta in
`.claude/skills/pubblica-release/SKILL.md`. Le due cose da non sbagliare:

- **i bersagli di uno stesso sistema in una sola invocazione** —
  `npx electron-builder --linux AppImage deb --x64`, mai due comandi separati
- **il nome dell'artefatto va corretto prima di caricarlo**: sul disco è
  `Fanta Help-0.1.0.AppImage` con lo spazio, il feed dichiara
  `Fanta-Help-0.1.0.AppImage` col trattino

E una conseguenza da conoscere: **una build Windows da Fedora lascia
`better-sqlite3` compilato per Windows**, quindi `npm run dev` smette di
funzionare finché non lanci `npx electron-builder install-app-deps`. Su un
runner non importa a nessuno; sulla tua macchina sì.

### Firma e aggiornamento automatico

|  | primo avvio | aggiornamento automatico |
|---|---|---|
| **Linux** | nessun attrito | ✅ |
| **Windows** | avviso SmartScreen, non firmato | ✅ — la firma non serve |
| **macOS** | tasto destro → «Apri», Gatekeeper blocca il doppio clic | ❌ — l'app rileva la versione nuova e apre la pagina di download |

Su macOS l'aggiornamento automatico richiede firma e notarizzazione, cioè
l'Apple Developer Program. **Per la v1 la decisione è: nessun certificato**
(documento 3 §8). È reversibile senza toccare una riga di logica: si aggiungono
le `CSC_*` alla build e lo stato `manual` smette di verificarsi.

---

## Dove sta il resto

| | |
|---|---|
| `docs/` | le specifiche, un file per documento: dominio e schema, viste e flussi, architettura, pipeline dati, roadmap, testing, design system |
| `CLAUDE.md` | le regole del progetto e **la tabella delle trappole** — cose che sono già costate tempo, con dentro come si riconoscono |
| `.claude/skills/` | le procedure eseguibili: aprire un task, chiudere una fase, provare un servizio, misurare un layout, pubblicare |
| `.claude.local.md` | note della singola macchina, fuori da git |
| `tools/dataset/README.md` | la pipeline dei dati, le fonti e la riconciliazione |

Le specifiche in `docs/` sono chiuse e motivate: quasi tutte le stranezze che ci
si trova sono deliberate. Se una sembra sbagliata, vale la pena chiedere prima
di correggerla.
