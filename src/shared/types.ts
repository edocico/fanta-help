/**
 * DTOs shared by main and renderer. Nothing here may depend on Node or the DOM:
 * this file is compiled by both tsconfig.node.json and tsconfig.web.json, which
 * is what turns rule 3 into a compile error rather than a promise.
 */

/**
 * Payload of the `app.instance` channel: who this installation is, plus the two
 * facts the Impostazioni view will need about where it keeps its data.
 */
export type AppInstance = {
  /** Identity of this installation. `auction_log.actor_uuid` and
   *  `league_snapshot.produced_by` record this value, so it never changes. */
  uuid: string
  /** Human name for the instance, set from the settings. Null until then. */
  label: string | null
  /** Application version, from package.json. */
  version: string
  /** Absolute path of the SQLite file. */
  databasePath: string
  /**
   * Value of `PRAGMA foreign_keys` as SQLite reports it after opening. Exposed so
   * the trap that silently costs half the constraints stays observable from
   * outside the main process, instead of being assumed.
   */
  foreignKeys: boolean
}
