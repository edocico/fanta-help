import { app, BrowserWindow } from 'electron'
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

// main and preload are built as CommonJS, so __dirname exists. See the note in
// package.json's missing `type: module`: the `electron` module is CJS with lazy
// getters, and named imports from it cannot be resolved by Node's ESM loader.

// app.getName() reads package.json, not electron-builder.yml, so dev and the
// installed app would otherwise resolve to the same userData directory and
// share one database. Split them before anything reads a path.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')} (dev)`)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
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
