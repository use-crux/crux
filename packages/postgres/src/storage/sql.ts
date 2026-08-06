import { StorageError } from '@use-crux/core/storage'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

export interface PgExecutor {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>
}

export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export function storageTable(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export async function withStorageTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function backendError(operation: string, cause: unknown): never {
  throw new StorageError('backend_error', `PostgreSQL storage ${operation} failed.`, { cause })
}
