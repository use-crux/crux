import { createStorageConnection } from './connection'
import { createRecordStore, postgresRecordStore } from './record-store'
import { createStorageSetup } from './setup'
import type { PostgresStorage, PostgresStorageOptions } from './types'
import { assertDimensions } from './validation'
import { createVectorStore, postgresVectorStore } from './vector-store'

export { postgresRecordStore } from './record-store'
export { postgresVectorStore } from './vector-store'

/** Create records and vectors over one PostgreSQL pool and setup lifecycle. */
export function postgresStorage(options: PostgresStorageOptions): PostgresStorage {
  assertDimensions(options?.dimensions, 'PostgreSQL dense dimensions')
  if (options.sparseDimensions !== undefined) {
    assertDimensions(options.sparseDimensions, 'PostgreSQL sparse dimensions')
  }
  const connection = createStorageConnection(options)
  const setup = createStorageSetup(connection.pool, connection.schema, {
    records: true,
    vectors: true,
    dimensions: options.dimensions,
    sparseDimensions: options.sparseDimensions,
  })
  return Object.freeze({
    records: createRecordStore(connection, false, setup),
    vectors: createVectorStore(connection, options.dimensions, options.sparseDimensions, false, setup),
    setup,
    async close() {
      if (connection.ownsPool) await connection.pool.end()
    },
  })
}

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
} from './types'
