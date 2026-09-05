import { app, BrowserWindow, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import type { EventPayload, EventTopic } from '@shared/contracts'
import {
  closeDb,
  databasePath,
  ensureInstance,
  foreignKeysEnabled,
  openDb,
  takeBackup,
} from './db/client'
import { registerAll, registerUnavailable } from './ipc/register'
import { createUpdateService, type UpdaterPort } from './services/update'
import { makeFakeUpdaterPort } from './services/update-fake'
import { readGrid } from './services/xlsx-reader'
import { writeGrid } from './services/xlsx-writer'

// main and preload are built as CommonJS, so __dirname exists. See the note in
// package.json's missing `type: module`: the `electron` module is CJS with lazy
// getters, and named imports from it cannot be resolved by Node's ESM loader.

// app.getName() reads package.json, not electron-builder.yml, so dev and the
// installed app would otherwise resolve to the same userData directory and
// share one database. Split them before anything reads a path.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')} (dev)`)
}

/**
 * The window the board of document 7 §10 needs, and why it is not 900×620.
 *
 * The auction screen is the one the app exists for, and §10 gives its board a
 * shape with an arithmetic the old size cannot hold. Counted rather than
 * guessed, and each number is here with what it depends on:
 *
 * **Height.** A roster is 25 slots (`DEFAULT_SLOTS`, 3+8+8+6) and §5 fixes the
 * board cell at 22px, so the cells alone are 550px — against the 484px the rose
 * list was measured at inside a 620px window (`base.css`, the block on
 * `--proj-*`). Add the column heading and the role separators and the board asks
 * for about 620px of its own. 900 of window leaves it that, with the top bar
 * and the macOS title bar paid for.
 *
 * **Width.** Ten columns, and a column has to hold a surname: measured on the
 * 524 of the 2026-27 listone, the median is 7 characters, the 90th percentile
 * 11, the longest 19 (`Milinkovic-Savic V.`). Beside it the price. During the
 * auction the assignment panel takes 320px flat and the rail 40 more, so the
 * board gets `width − 360`: at 1440 that is 1080, which is what ten columns
 * want. At the 1100 minimum it is 740, and the board hands over to the narrow
 * fallback §10 asks for — which is the point of having a minimum at all rather
 * than letting the window go to nothing.
 *
 * If any of those change — the default slots, the 22px of §5, the 320px of the
 * assignment panel — these two numbers are the ones to recount.
 */
const WINDOW = { width: 1440, height: 900, minWidth: 1100, minHeight: 700 }

function createWindow(): void {
  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Il renderer non apre link, e con T20 resta vero anche ora che un link
  // esterno esiste: lo stato `manual` del §8 apre la pagina della Release con
  // `shell.openExternal` **dal main**, e l'URL non passa mai di qua. Questa
  // riga nega quindi ancora tutto, e non c'è nessuna allowlist da tenere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // electron-vite sets ELECTRON_RENDERER_URL in dev. The isPackaged guard is not
  // decoration: without it, anyone able to set that variable for the app's launch
  // loads their own page into the window that carries the preload bridge.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Chi trasmette un topic ai renderer.
 *
 * Estratto dal letterale di `registerAll` perché ha due chiamanti che non si
 * incontrano: gli handler, e il servizio di aggiornamento, che emette da solo
 * quando l'updater gli parla — anche mentre nessuno ha invocato niente.
 * Duplicarlo sarebbe due copie che divergono al primo cambiamento.
 *
 * Ogni finestra aperta, non una `webContents` ricordata: su macOS una finestra
 * si chiude e si riapre, e un riferimento stantio manda i messaggi dentro un
 * renderer distrutto invece che in quello vivo.
 */
function emit<T extends EventTopic>(topic: T, payload: EventPayload<T>): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(`event:${topic}`, payload)
  }
}

/**
 * L'unico posto in cui `electron-updater` viene toccato, documento 3 §8.
 *
 * **I due interruttori sono due, e il secondo è quello che tradisce.**
 * `autoDownload` è vero per default e scaricherebbe centoventi megabyte senza
 * chiedere; `autoInstallOnAppQuit` è vero per default e installerebbe **alla
 * chiusura dell'app**, saltando in silenzio il rifiuto «asta in corso» che
 * questo task esiste per garantire. Spegnere solo il primo lascia il buco
 * peggiore dei due: verificati leggendo `AppUpdater.js` del pacchetto 6.8.9,
 * righe 109 e 114.
 */
function makeUpdaterPort(): UpdaterPort {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  return {
    check: async () => {
      await autoUpdater.checkForUpdates()
    },
    download: async () => {
      await autoUpdater.downloadUpdate()
    },
    install: () => autoUpdater.quitAndInstall(),
    /**
     * Il primo link esterno dell'applicazione, e la riga sopra
     * `setWindowOpenHandler` lo prevedeva: «No external links exist yet. The
     * allowlist arrives with the first one.» Arriva qui, e non passa dal
     * renderer: `shell.openExternal` sta nel main, e l'unico URL che raggiunge
     * questa funzione è quello che l'updater ha letto dal feed della repo.
     */
    openDownloadPage: (url) => void shell.openExternal(url),
    listen: (h) => {
      autoUpdater.on('checking-for-update', () => h.checking())
      autoUpdater.on('update-available', (info) =>
        h.available({
          version: info.version,
          // Il feed Atom di GitHub le dà in HTML. Il tipo le ammette anche come
          // elenco di note per versione: lì non c'è niente da mostrare in una
          // riga sola, e una stringa vuota direbbe «nessuna nota» sbagliando.
          notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
          url: `https://github.com/edocico/fanta-help/releases/tag/v${info.version}`,
        }),
      )
      autoUpdater.on('update-not-available', () => h.none())
      autoUpdater.on('download-progress', (p) => h.progress(p.percent))
      autoUpdater.on('update-downloaded', (info) => h.downloaded(info.version))
      autoUpdater.on('error', (e) => h.failed(e.message))
    },
    /**
     * Se questa app, qui dove sta girando, sa installarsi da sé.
     *
     * Due fatti di natura diversa, e tenerli separati è ciò che rende la riga
     * giusta su tutti e tre i sistemi. **La piattaforma è un fatto di
     * runtime** — `process.platform` qui è la macchina che *esegue*, sempre
     * vera. **La firma è un fatto di build**, e arriva dalla costante.
     *
     * Fusi in una costante sola leggevano tutti e due la macchina che
     * costruisce: un pacchetto Windows nato sul Mac avrebbe detto per sempre
     * «Apri la pagina di download», su un sistema che il §8 dichiara capace di
     * aggiornarsi anche senza firma. Il giorno del certificato si danno le
     * `CSC_*` alla build e questa riga non si tocca, che è la promessa scritta
     * nel documento.
     */
    canInstallItself: process.platform !== 'darwin' || __MAC_SIGNED__,
  }
}

void app.whenReady().then(() => {
  try {
    // openDb runs the migrations. If they fail here, they fail loudly.
    const db = openDb()
    const { uuid, label } = ensureInstance(db)

    /**
     * Costruito qui e non dentro `handlers.ts` per due ragioni che tirano nello
     * stesso verso: importa `electron-updater`, che `coverage.test.ts` non può
     * caricare, e vive quanto il processo — tiene l'ultimo stato e resta in
     * ascolto, quindi non può nascere a ogni invocazione.
     *
     * Il topic lo nomina questa riga invece dell'handler, che è la forma di
     * `dataset.progress`: là il servizio è chiamato una volta per import e
     * l'handler lo compone, qui è un ascoltatore permanente e l'handler non ha
     * nessun momento in cui legarlo.
     */
    /**
     * Il finto solo fuori dal pacchetto, e solo se qualcuno lo chiede.
     *
     * Le due condizioni sono legate da `&&` e non da `||` per una ragione che
     * vale la riga in più: `app.isPackaged` da solo lascerebbe la variabile
     * capace di spegnere gli aggiornamenti di un'app installata, e una
     * variabile d'ambiente che disattiva in silenzio il meccanismo di
     * aggiornamento è il genere di interruttore che si scopre un anno dopo.
     */
    const fake = !app.isPackaged ? process.env.FANTA_FAKE_UPDATER : undefined
    const update = createUpdateService({
      db,
      updater:
        fake === undefined ? makeUpdaterPort() : makeFakeUpdaterPort(fake),
      emit: (status) => emit('update.status', status),
    })

    registerAll({
      db,
      backup: takeBackup,
      readGrid,
      // The renderer never names a path of its own: it asks for the dialog and
      // gets back whatever the person actually picked.
      chooseXlsx: async () => {
        const chosen = await dialog.showOpenDialog({
          title: 'Scegli il listone',
          filters: [{ name: 'Listone Fantacalcio', extensions: ['xlsx'] }],
          properties: ['openFile'],
        })
        return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
      },
      /**
       * Dove salvare un export, col nome proposto dal servizio.
       *
       * `showSaveDialog` non scrive niente: torna un percorso, e il file lo
       * scrive chi ha i dati. Il filtro si ricava dall'estensione del nome
       * proposto, così l'unico posto che decide come si chiama un export resta
       * `fileNameFor`.
       */
      chooseSaveTo: async (name) => {
        const extension = name.split('.').pop() ?? 'json'
        const chosen = await dialog.showSaveDialog({
          title: 'Salva il resoconto',
          defaultPath: join(app.getPath('downloads'), name),
          filters: [
            {
              name: extension === 'xlsx' ? 'Foglio di calcolo' : 'Resoconto Fanta Help',
              extensions: [extension],
            },
          ],
        })
        return chosen.canceled ? null : (chosen.filePath ?? null)
      },
      chooseSnapshot: async () => {
        const chosen = await dialog.showOpenDialog({
          title: 'Scegli il resoconto da importare',
          filters: [{ name: 'Resoconto Fanta Help', extensions: ['json'] }],
          properties: ['openFile'],
        })
        return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
      },
      writeGrid,
      emit,
      update,
      instance: {
        uuid,
        label,
        version: app.getVersion(),
        databasePath: databasePath(),
        foreignKeys: foreignKeysEnabled(),
      },
    })

    /**
     * Qualche secondo, e non zero: all'apertura il main sta già migrando il
     * database e il renderer sta montando la prima vista, e una richiesta di
     * rete in mezzo si paga sull'unica cosa che l'utente guarda.
     *
     * `unref` perché è un timer che non deve tenere vivo il processo: chiudere
     * l'app dopo due secondi non deve aspettare il controllo.
     *
     * Nessun `catch`: `check()` non lancia mai — converte da sé nello stato
     * `error`, che è la riga che il documento 2 §4.12 vuole far vedere.
     */
    setTimeout(() => void update.check(), 4000).unref()

    /*
      Col database chiuso non c'è nessun controllo e i canali `update.*`
      rispondono `DB_UNAVAILABLE` come tutti gli altri, ed è una scelta: il
      servizio ha bisogno di `db` per la guardia dell'asta, e senza database
      nessuna lega può essere in `auction` — quindi la guardia non avrebbe
      niente su cui decidere. Chi si trova lì ha un problema più grande di una
      versione vecchia, e lo schermo glielo dice già.
    */
  } catch (e) {
    // The window still opens and every channel answers DB_UNAVAILABLE, which is
    // what makes a packaging failure legible instead of a blank screen.
    console.error('apertura del database fallita', e)
    registerUnavailable()
  }

  createWindow()

  /**
   * Il controllo all'avvio, documento 3 §8: «in ritardo di qualche secondo per
   * non rallentare l'apertura».
   *
   * Dentro il `try` e non dopo, perché `update` esiste solo se il database si è
   * aperto: nel ramo `registerUnavailable` non c'è nessun servizio da chiamare.
   * Il timer è quindi armato là dentro — questa riga sta qui solo per dire
   * perché non la trovi qui.
   */

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDb()
})
