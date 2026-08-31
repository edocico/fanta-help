---
name: prova-pacchetto
description: Costruisce l'app, la lancia e stampa quello che mostra davvero a schermo, leggendo il DOM via protocollo DevTools. Usare per verificare una schermata in sviluppo o per provare il pacchetto installabile alla fine di una fase.
disable-model-invocation: true
version: 0.1.0
---

# Prova il pacchetto

Il `CLAUDE.md` chiede due cose che questa skill mette insieme: **produrre un
pacchetto installabile alla fine di ogni fase e provarlo**, e **leggere cosa
mostra davvero l'app** interrogando il DOM via DevTools invece di dedurlo.

## Come si usa

```bash
bash .claude/skills/prova-pacchetto/run.sh dev  [porta]   # sviluppo, dalla out/
bash .claude/skills/prova-pacchetto/run.sh pack [porta]   # AppImage x64, poi la lancia
```

La porta predefinita è 9222. Lo script costruisce, avvia, aspetta la finestra,
stampa il testo a schermo e alcune proprietà calcolate (`window.api`, colore di
sfondo, famiglia di caratteri), poi lascia l'app aperta e dice come chiuderla.

Se serve un controllo diverso da quelli predefiniti, aggiungi una `evaluate()`
in `probe.mjs`: prende un'espressione JavaScript e la valuta nel renderer.

## Cosa verifica un'esecuzione riuscita

- Il modulo nativo `better-sqlite3` si carica sotto l'ABI di Electron.
- L'`asarUnpack` è completo (in modo `pack`: in sviluppo l'asar non esiste).
- Il ponte IPC risponde e `window.api` è un oggetto.
- I fogli di stile si risolvono sotto `file://`, che è il punto in cui T2 di
  solito si rompe.
- Il percorso del database: `Fanta Help (dev)` in sviluppo, `Fanta Help` nel
  pacchetto. Se coincidono, la separazione dei dati utente è saltata.

## Le tre trappole già codificate nello script

Non vanno riscoperte, e nessuna delle tre si annuncia quando scatta.

| Trappola | Cosa succede | Cosa fa lo script |
|---|---|---|
| `ELECTRON_RUN_AS_NODE=1` | VS Code la esporta nei suoi terminali. Electron esegue il main come Node normale, `require('electron').app` è `undefined`, e l'app muore su `isPackaged` senza nominare la causa | lancia con `env -u ELECTRON_RUN_AS_NODE` |
| `pkill -f` | Uccide la shell chiamante: il Bash tool avvolge ogni comando in `bash -c 'eval "<testo completo>"'`, quindi il pattern sta nel cmdline dell'avvolgitore e combacia con sé stesso. Esce con 144, e i passi successivi non girano mai | chiude solo per PID salvato, e i figli con `pkill -P` (per padre, non per pattern) |
| AppImage senza FUSE2 | Fedora non spedisce libfuse2, l'AppImage non parte | la lancia con `--appimage-extract-and-run` |

## Limiti noti su questa macchina

- **Solo x64.** L'`electron-builder.yml` fissa `[x64, arm64]`, ma una build
  arm64 ricompila `better-sqlite3` per l'architettura sbagliata e ce la lascia,
  rompendo `npm run dev` finché non si rilancia
  `electron-builder install-app-deps`. Lo script passa `--x64` apposta.
- **Il `.deb` non si costruisce.** L'`fpm` incluso in electron-builder porta il
  proprio Ruby, che cerca `libcrypt.so.1`, rimossa da Fedora. Serve
  `sudo dnf install libxcrypt-compat`. Per questo lo script costruisce solo
  l'AppImage.
- **Non fidarti del codice di uscita** di una build incanalata in una pipe: è
  quello dell'ultimo comando della pipe. Le righe che contano sono quelle
  marcate `⨯`.

## Se non compare nessun target DevTools

Nell'ordine: `ELECTRON_RUN_AS_NODE` ancora impostata; la porta occupata da
un'istanza precedente (`app.log` lo dice: `bind() failed`); oppure il main è
morto all'avvio, e allora la causa è nelle prime righe di
`.claude/skills/prova-pacchetto/.run/app.log`.
