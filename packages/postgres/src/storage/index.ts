import { StorageError } from '@use-crux/core/storage'
import { createStorageConnection } from './connection'
import { createRecordStore, postgresRecordStore } from './record-store'
import { createSearchStore, postgresSearchStore } from './search-store'
import { createStorageSetup } from './setup'
import type { PostgresStorage, PostgresStorageOptions } from './types'
import { assertOptionalDimensions } from './validation'

export { postgresRecordStore } from './record-store'
export { postgresSearchStore } from './search-store'

/** Create records and search over one PostgreSQL pool and setup lifecycle. */
export function postgresStorage(options: PostgresStorageOptions): PostgresStorage {
  assertOptionalDimensions(options?.dimensions, 'PostgreSQL dense dimensions')
  assertOptionalDimensions(options?.sparseDimensions, 'PostgreSQL sparse dimensions')
  const lexical = options?.lexical !== undefined
  if (options?.dimensions === undefined && options?.sparseDimensions === undefined && !lexical) {
    throw new StorageError(
      'invalid_value',
      'PostgreSQL search storage requires dimensions, sparseDimensions, or lexical search.',
    )
  }
  const connection = createStorageConnection(options)
  const lexicalConfiguration = normalizeLexicalConfiguration(options.lexical)
  const payloads = {
    ...(options.dimensions !== undefined ? { dimensions: options.dimensions } : {}),
    ...(options.sparseDimensions !== undefined ? { sparseDimensions: options.sparseDimensions } : {}),
    lexical,
  }
  const setup = createStorageSetup(connection.pool, connection.schema, {
    records: true,
    search: true,
    dimensions: options.dimensions,
    sparseDimensions: options.sparseDimensions,
    ...(lexical ? { lexicalConfiguration } : {}),
  })
  return Object.freeze({
    records: createRecordStore(connection, false, setup),
    search: createSearchStore(connection, payloads, lexicalConfiguration, false, setup),
    setup,
    async close() {
      if (connection.ownsPool) await connection.pool.end()
    },
  })
}

function normalizeLexicalConfiguration(value: PostgresStorageOptions['lexical']): string {
  if (value === undefined) return 'simple'
  if (value === true || value.configuration === undefined) return 'simple'
  if (typeof value.configuration !== 'string' || value.configuration.length === 0 || value.configuration.includes('\0')) {
    throw new StorageError('invalid_value', 'PostgreSQL text-search configuration must be a non-empty string.')
  }
  return value.configuration
}

export type {
  PostgresRecordStore,
  PostgresRecordStoreOptions,
  PostgresLexicalOptions,
  PostgresSearchStore,
  PostgresSearchStoreOptions,
  PostgresStorage,
  PostgresStorageConnectionOptions,
  PostgresStorageOptions,
  PostgresStorageSetup,
  PostgresStorageSetupFinding,
  PostgresStorageSetupResult,
} from './types'
