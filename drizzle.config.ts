import { defineConfig } from 'drizzle-kit'

// The generated SQL lands in ./drizzle, which electron-builder ships as an
// extraResource so it sits next to app.asar rather than inside it.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
})
