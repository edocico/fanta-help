import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Vitest warns that this file uses ESM syntax while being loaded as CommonJS,
// and suggests `"type": "module"` in package.json. DO NOT follow that advice:
// it makes electron-vite emit an ESM main, and `import { BrowserWindow } from
// 'electron'` then dies at module instantiation with exit code 0 and an empty
// stderr. See the traps table in CLAUDE.md. The warning is harmless; when Vite
// makes the native loader the default, rename this to .mts and swap __dirname
// for import.meta.dirname.

// A separate file on purpose: electron.vite.config.ts exports the three-target
// main/preload/renderer structure, which Vitest cannot interpret.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  test: {
    environment: 'node',
    // tools/** is included because the data pipeline has one function worth
    // testing on its own: name normalisation. It arrives with T5.
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
})
