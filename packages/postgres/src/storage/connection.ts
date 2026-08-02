import { StorageError } from '@use-crux/core/storage'
import { Pool } from 'pg'
import type { PostgresStorageConnectionOptions } from './types'
import { assertSchema } from './validation'

export const DEFAULT_POSTGRES_STORAGE_SCHEMA = 'crux_storage'

export interface PostgresStorageConnection {
  readonly pool: Pool
  readonly schema: string
  readonly ownsPool: boolean
}

export function createStorageConnection(options: PostgresStorageConnectionOptions): PostgresStorageConnection {
  const schema = options.schema ?? DEFAULT_POSTGRES_STORAGE_SCHEMA
  assertSchema(schema)
  const connectionString = options.url ?? process.env.DATABASE_URL
  if (!options.pool && !connectionString) {
    throw new StorageError('backend_error', 'PostgreSQL storage requires a pool, url, or DATABASE_URL.')
  }
  return {
    schema,
    ownsPool: options.pool === undefined,
    pool: options.pool ?? new Pool({ ...options.poolOptions, connectionString }),
  }
}
