import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

export interface PgExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export type PgClient = Pool | PoolClient

export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export function table(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export function advisoryLockKey(schema: string): number {
  let hash = 0
  for (let index = 0; index < schema.length; index += 1) {
    hash = (hash * 31 + schema.charCodeAt(index)) | 0
  }
  return hash
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
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
