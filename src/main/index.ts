import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { closeDb, databasePath, ensureInstance, foreignKeysEnabled, openDb } from './db/client'
import { fail, ok, type Result } from '@shared/errors'
import type { AppInstance } from '@shared/types'

// main and preload are built as CommonJS, so __dirname exists. See the note in
// package.json's missing `type: module`: the `electron` module is CJS with lazy
// getters, and named imports from it cannot be resolved by Node's ESM loader.

// app.getName() reads package.json, not electron-builder.yml, so dev and the
// installed app would otherwise resolve to the same userData directory and
// share one database. Split them before anything reads a path.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')} (dev)`)
}

/** Filled once at startup: the boot row is written when the app opens, not per request. */
let instance: AppInstance | null = null

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

ipcMain.handle('app.instance', (): Result<AppInstance> => {
  // The only way `instance` stays null is openDb() throwing, i.e. the migrations
  // failing — the exact breakage T3 exists to make legible. The generic UNKNOWN
  // would say neither what happened nor what to do.
  if (!instance) return fail('DB_UNAVAILABLE')
  return ok(instance)
})

void app.whenReady().then(() => {
  try {
    // openDb runs the migrations. If they fail here, they fail loudly.
    const db = openDb()
    const { uuid, label } = ensureInstance(db)
    instance = {
      uuid,
      label,
      version: app.getVersion(),
      databasePath: databasePath(),
      foreignKeys: foreignKeysEnabled(),
    }
  } catch (e) {
    // Leave `instance` null: the channel reports it and the window still opens,
    // which is what makes a packaging failure legible instead of a blank screen.
    console.error('apertura del database fallita', e)
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
