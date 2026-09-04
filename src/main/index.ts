import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import {
  closeDb,
  databasePath,
  ensureInstance,
  foreignKeysEnabled,
  openDb,
  takeBackup,
} from './db/client'
import { registerAll, registerUnavailable } from './ipc/register'
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

  // No external links exist yet. The allowlist arrives with the first one.
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

void app.whenReady().then(() => {
  try {
    // openDb runs the migrations. If they fail here, they fail loudly.
    const db = openDb()
    const { uuid, label } = ensureInstance(db)

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
      // Every open window, rather than one remembered webContents: a window can
      // be closed and reopened on macOS, and a stale reference sends progress
      // into a destroyed renderer instead of the live one.
      emit: (topic, payload) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(`event:${topic}`, payload)
        }
      },
      instance: {
        uuid,
        label,
        version: app.getVersion(),
        databasePath: databasePath(),
        foreignKeys: foreignKeysEnabled(),
      },
    })
  } catch (e) {
    // The window still opens and every channel answers DB_UNAVAILABLE, which is
    // what makes a packaging failure legible instead of a blank screen.
    console.error('apertura del database fallita', e)
    registerUnavailable()
  }

  createWindow()

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
