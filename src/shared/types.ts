/**
 * DTOs shared by main and renderer. Nothing here may depend on Node or the DOM:
 * this file is compiled by both tsconfig.node.json and tsconfig.web.json, which
 * is what turns rule 3 into a compile error rather than a promise.
 */

/** Payload of the `app.instance` channel. */
export type AppInstance = {
  /** Application version, from package.json. */
  version: string
  /** Absolute path of the SQLite file, shown so the spike proves where it wrote. */
  databasePath: string
  /** How many times the app has opened this database. Proves the row survives a restart. */
  bootCount: number
  /** ISO timestamp of the current boot, read back from SQLite. */
  bootedAt: string
  /**
   * Value of `PRAGMA foreign_keys` as SQLite reports it after opening.
   * On screen so the trap that costs half the constraints is visible, not assumed.
   */
  foreignKeys: boolean
}
