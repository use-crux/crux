/**
 * `@use-crux/postgres` — first-party PostgreSQL Connected Knowledge storage.
 *
 * @module
 */

export { postgresRecordStore, postgresStorage, postgresVectorStore } from './storage/index'
export type {
  PostgresRecordStore,
  PostgresRecordStoreOptions,
  PostgresStorage,
  PostgresStorageConnectionOptions,
  PostgresStorageOptions,
  PostgresStorageSetup,
  PostgresStorageSetupFinding,
  PostgresStorageSetupResult,
  PostgresVectorStore,
  PostgresVectorStoreOptions,
} from './storage/index'
