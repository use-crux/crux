/**
 * `@use-crux/postgres` — first-party PostgreSQL Connected Knowledge storage.
 *
 * @module
 */

export { postgresRecordStore, postgresSearchStore, postgresStorage } from './storage/index'
export type {
  PostgresLexicalOptions,
  PostgresRecordStore,
  PostgresRecordStoreOptions,
  PostgresSearchStore,
  PostgresSearchStoreOptions,
  PostgresStorage,
  PostgresStorageConnectionOptions,
  PostgresStorageOptions,
  PostgresStorageSetup,
  PostgresStorageSetupFinding,
  PostgresStorageSetupResult,
} from './storage/index'
