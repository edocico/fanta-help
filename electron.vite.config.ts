import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// externalizeDepsPlugin keeps `dependencies` out of the main/preload bundles.
// better-sqlite3 is a native .node binary: rollup cannot inline it, and the
// failure it produces when it tries never mentions the word "native".
//
// main and preload are emitted as CommonJS, which is electron-vite's default
// and depends on package.json NOT declaring `type: module`. Do not add it back:
// under real ESM, `import { BrowserWindow } from 'electron'` throws at module
// instantiation and the app dies with exit code 0 and an empty stderr.
//
// Tailwind v4 has no config file: the design tokens live in @theme inside
// src/renderer/src/styles/base.css.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // La costante di build del documento 3 §8, e dice UNA cosa sola: se questa
    // build è firmata per macOS. Non «se sa aggiornarsi», che è la domanda a
    // valle e dipende anche dalla piattaforma su cui l'app *gira*.
    //
    // La distinzione è costata un rilievo bloccante. `electron-vite build`
    // emette **un solo** `out/main/index.js` che electron-builder impacchetta
    // per tutti e tre i bersagli: una costante che dicesse «sa aggiornarsi»
    // leggendo `process.platform` qui leggerebbe la macchina che costruisce, e
    // un pacchetto Windows nato sul Mac direbbe per sempre «Apri la pagina di
    // download» — su un sistema dove l'aggiornamento automatico funziona anche
    // senza firma, come il §8 scrive per esteso. E siccome questo progetto si
    // sviluppa su due macchine, da Fedora la risposta sarebbe sempre giusta e
    // il difetto invisibile.
    //
    // La piattaforma la decide `index.ts` a runtime, dove è un fatto vero.
    // `CSC_LINK` e `CSC_NAME` sono le variabili con cui electron-builder riceve
    // un'identità di firma: darle accende da sé questa costante, quindi il
    // giorno del certificato si cambia la configurazione della firma e basta —
    // che è la promessa del documento. Chi firmasse dichiarando `mac.identity`
    // nell'yml invece che con le variabili deve aggiungere quel caso qui.
    define: {
      __MAC_SIGNED__: JSON.stringify(
        process.env.CSC_LINK !== undefined || process.env.CSC_NAME !== undefined,
      ),
    },
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
