import type {
  JsonObject,
  RecordStore,
  Storage,
  StorageSetupFinding,
  StorageSetupPort,
  StorageSetupResult,
  VectorStore,
} from '@use-crux/core/storage'
import type { Pool, PoolConfig } from 'pg'

/** Non-mutating or additive PostgreSQL storage setup diagnostic. */
export type PostgresStorageSetupFinding = StorageSetupFinding

/** Result returned by PostgreSQL storage setup checks. */
export type PostgresStorageSetupResult = StorageSetupResult

/** Explicit setup lifecycle shared by PostgreSQL storage adapters. */
export type PostgresStorageSetup = StorageSetupPort

/** Shared PostgreSQL connection options. */
export interface PostgresStorageConnectionOptions {
  /** Connection string. Defaults to `DATABASE_URL` when no pool is supplied. */
  readonly url?: string
  /** Caller-owned pool. Crux never closes it. */
  readonly pool?: Pool
  /** Pool options used only when Crux creates the pool. */
  readonly poolOptions?: Omit<PoolConfig, 'connectionString'>
  /** Storage schema. Defaults to `crux_storage`. */
  readonly schema?: string
}

/** Options accepted by {@link postgresRecordStore}. */
export interface PostgresRecordStoreOptions extends PostgresStorageConnectionOptions {}

/** Options accepted by {@link postgresVectorStore}. */
export interface PostgresVectorStoreOptions extends PostgresStorageConnectionOptions {
  /** Exact width of every dense vector. */
  readonly dimensions: number
  /** Sparse vector width. Enables sparse, hybrid, and RRF search. */
  readonly sparseDimensions?: number
}

/** Options accepted by {@link postgresStorage}. */
export interface PostgresStorageOptions extends PostgresVectorStoreOptions {}

/** PostgreSQL-backed RecordStore with explicit setup and ownership. */
export interface PostgresRecordStore<T extends JsonObject = JsonObject> extends RecordStore<T> {
  readonly setup: PostgresStorageSetup
  /** Close only a pool created by this adapter. */
  close(): Promise<void>
}

/** PostgreSQL-backed VectorStore with explicit setup and ownership. */
export interface PostgresVectorStore extends VectorStore {
  readonly setup: PostgresStorageSetup
  /** Close only a pool created by this adapter. */
  close(): Promise<void>
}

/** Composed PostgreSQL storage bundle sharing one pool and setup lifecycle. */
export interface PostgresStorage extends Storage {
  readonly records: RecordStore
  readonly vectors: VectorStore
  readonly setup: PostgresStorageSetup
  /** Close the bundle-owned pool. Caller-owned pools are left open. */
  close(): Promise<void>
}
