import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
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
// Tailwind is added to the renderer in T2, not here.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
  },
})
