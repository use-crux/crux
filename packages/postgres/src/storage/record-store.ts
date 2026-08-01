import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  JsonObject,
  RecordEntry,
  RecordListOptions,
  RecordPage,
  RecordWrite,
  RecordWriteOptions,
} from '@use-crux/core/storage'
import { createStorageConnection, type PostgresStorageConnection } from './connection'
import { createStorageSetup } from './setup'
import { backendError, storageTable, withStorageTransaction, type PgExecutor } from './sql'
import type { PostgresRecordStore, PostgresRecordStoreOptions, PostgresStorageSetup } from './types'
import { assertKey, cloneJsonObject, expiresAt, normalizeListOptions } from './validation'

interface RecordRow {
  readonly key: string
  readonly value: JsonObject
}

interface VersionedRecordRow extends RecordRow {
  readonly version: string
}

/** Create a PostgreSQL-backed JSON RecordStore. */
export function postgresRecordStore<T extends JsonObject = JsonObject>(
  options: PostgresRecordStoreOptions = {},
): PostgresRecordStore<T> {
  const connection = createStorageConnection(options)
  return createRecordStore(connection, connection.ownsPool)
}

export function createRecordStore<T extends JsonObject = JsonObject>(
  connection: PostgresStorageConnection,
  closeOwnedPool = false,
  setup: PostgresStorageSetup = createStorageSetup(connection.pool, connection.schema, {
    records: true,
    vectors: false,
  }),
): PostgresRecordStore<T> {
  const { pool, schema } = connection
  const table = storageTable(schema, 'records')

  async function get(key: string): Promise<T | null> {
    assertKey(key, 'Record')
    try {
      const result = await pool.query<{ value: T }>(
        `SELECT value FROM ${table}
         WHERE key = $1 AND (expires_at IS NULL OR expires_at > $2)`,
        [key, now()],
      )
      return result.rows[0] ? cloneJsonObject<T>(result.rows[0].value) : null
    } catch (cause) {
      return backendError('read', cause)
    }
  }

  async function putWith(executor: PgExecutor, key: string, value: T, options?: RecordWriteOptions): Promise<void> {
    await executor.query(
      `INSERT INTO ${table} (key, value, expires_at, version)
       VALUES ($1, $2::jsonb, $3, 1)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         expires_at = EXCLUDED.expires_at,
         version = ${table}.version + 1`,
      [key, JSON.stringify(value), expiresAt(options)],
    )
  }

  async function list(prefix: string, options?: RecordListOptions): Promise<RecordPage<T>> {
    if (typeof prefix !== 'string') {
      throw new StorageError('invalid_key', 'Record prefixes must be strings.')
    }
    const normalized = normalizeListOptions(options)
    if (normalized.limit === 0) return { entries: [] }
    const after = normalized.cursor ? decodeCursor(normalized.cursor) : undefined
    const values: unknown[] = [escapeLike(prefix) + '%', now()]
    const conditions = [`key LIKE $1 ESCAPE '\\'`, `(expires_at IS NULL OR expires_at > $2)`]
    if (after !== undefined) {
      values.push(after)
      conditions.push(`key > $${values.length}`)
    }
    if (normalized.filter !== undefined) {
      values.push(JSON.stringify(normalized.filter))
      conditions.push(`value @> $${values.length}::jsonb`)
    }
    values.push(normalized.limit + 1)
    try {
      const result = await pool.query<RecordRow>(
        `SELECT key, value FROM ${table}
         WHERE ${conditions.join(' AND ')}
         ORDER BY key ASC
         LIMIT $${values.length}`,
        values,
      )
      const hasMore = result.rows.length > normalized.limit
      const rows = result.rows.slice(0, normalized.limit)
      return {
        entries: rows.map((row) => ({
          key: row.key,
          value: cloneJsonObject<T>(row.value),
        })),
        ...(hasMore && rows.length > 0 ? { cursor: encodeCursor(rows.at(-1)!.key) } : {}),
      }
    } catch (cause) {
      return backendError('list', cause)
    }
  }

  const store: PostgresRecordStore<T> = {
    _tag: 'RecordStore',
    setup,
    get,
    async getMany(keys) {
      keys.forEach((key) => assertKey(key, 'Record'))
      if (keys.length === 0) return []
      try {
        const result = await pool.query<RecordRow>(
          `SELECT key, value FROM ${table}
           WHERE key = ANY($1::text[])
             AND (expires_at IS NULL OR expires_at > $2)`,
          [[...new Set(keys)], now()],
        )
        const byKey = new Map(result.rows.map((row) => [row.key, cloneJsonObject<T>(row.value)]))
        return keys.map((key) => byKey.get(key) ?? null)
      } catch (cause) {
        return backendError('batch read', cause)
      }
    },
    async put(key, value, options) {
      assertKey(key, 'Record')
      const stored = cloneJsonObject<T>(value)
      // Validate TTL before backend I/O.
      expiresAt(options)
      try {
        await putWith(pool, key, stored, options)
      } catch (cause) {
        backendError('write', cause)
      }
    },
    async putMany(entries: readonly RecordWrite<T>[]) {
      const deduplicated = new Map<string, { readonly value: T; readonly options?: RecordWriteOptions }>()
      for (const entry of entries) {
        assertKey(entry.key, 'Record')
        const value = cloneJsonObject<T>(entry.value)
        expiresAt(entry.options)
        deduplicated.set(entry.key, {
          value,
          ...(entry.options ? { options: entry.options } : {}),
        })
      }
      if (deduplicated.size === 0) return
      try {
        await withStorageTransaction(pool, async (client) => {
          for (const [key, entry] of deduplicated) {
            await putWith(client, key, entry.value, entry.options)
          }
        })
      } catch (cause) {
        backendError('batch write', cause)
      }
    },
    async create(key, value, options) {
      assertKey(key, 'Record')
      const stored = cloneJsonObject<T>(value)
      const expiration = expiresAt(options)
      try {
        const result = await pool.query(
          `INSERT INTO ${table} (key, value, expires_at, version)
           VALUES ($1, $2::jsonb, $3, 1)
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             expires_at = EXCLUDED.expires_at,
             version = ${table}.version + 1
           WHERE ${table}.expires_at IS NOT NULL AND ${table}.expires_at <= $4
           RETURNING key`,
          [key, JSON.stringify(stored), expiration, now()],
        )
        return result.rowCount === 1
      } catch (cause) {
        return backendError('create', cause)
      }
    },
    async delete(key) {
      assertKey(key, 'Record')
      try {
        await pool.query(`DELETE FROM ${table} WHERE key = $1`, [key])
      } catch (cause) {
        backendError('delete', cause)
      }
    },
    async deleteMany(keys) {
      keys.forEach((key) => assertKey(key, 'Record'))
      if (keys.length === 0) return
      try {
        await pool.query(`DELETE FROM ${table} WHERE key = ANY($1::text[])`, [[...new Set(keys)]])
      } catch (cause) {
        backendError('batch delete', cause)
      }
    },
    list,
    async *scan(prefix, options) {
      let cursor: string | undefined
      do {
        const page = await list(prefix, { ...options, cursor })
        yield* page.entries as readonly RecordEntry<T>[]
        cursor = page.cursor
      } while (cursor !== undefined)
    },
    async getVersioned(key) {
      assertKey(key, 'Record')
      try {
        const result = await pool.query<VersionedRecordRow>(
          `SELECT key, value, version::text AS version FROM ${table}
           WHERE key = $1 AND (expires_at IS NULL OR expires_at > $2)`,
          [key, now()],
        )
        const row = result.rows[0]
        return row ? { value: cloneJsonObject<T>(row.value), version: row.version } : { value: null, version: null }
      } catch (cause) {
        return backendError('versioned read', cause)
      }
    },
    async putVersioned(key, value, expectedVersion) {
      assertKey(key, 'Record')
      assertVersion(expectedVersion)
      const stored = value === null ? null : cloneJsonObject<T>(value)
      const currentTime = now()
      try {
        if (expectedVersion === null) {
          if (stored === null) {
            const result = await pool.query<{ committed: boolean }>(
              `WITH expired AS (
                 DELETE FROM ${table}
                 WHERE key = $1 AND expires_at IS NOT NULL AND expires_at <= $2
               )
               SELECT NOT EXISTS (
                 SELECT 1 FROM ${table}
                 WHERE key = $1 AND (expires_at IS NULL OR expires_at > $2)
               ) AS committed`,
              [key, currentTime],
            )
            return result.rows[0]?.committed === true
          }
          const result = await pool.query(
            `INSERT INTO ${table} (key, value, expires_at, version)
             VALUES ($1, $2::jsonb, NULL, 1)
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               expires_at = NULL,
               version = ${table}.version + 1
             WHERE ${table}.expires_at IS NOT NULL AND ${table}.expires_at <= $3
             RETURNING key`,
            [key, JSON.stringify(stored), currentTime],
          )
          return result.rowCount === 1
        }
        const result =
          stored === null
            ? await pool.query(
                `DELETE FROM ${table}
                 WHERE key = $1 AND version = $2::bigint
                   AND (expires_at IS NULL OR expires_at > $3)
                 RETURNING key`,
                [key, expectedVersion, currentTime],
              )
            : await pool.query(
                `UPDATE ${table}
                 SET value = $2::jsonb, expires_at = NULL, version = version + 1
                 WHERE key = $1 AND version = $3::bigint
                   AND (expires_at IS NULL OR expires_at > $4)
                 RETURNING key`,
                [key, JSON.stringify(stored), expectedVersion, currentTime],
              )
        return result.rowCount === 1
      } catch (cause) {
        return backendError('compare-and-set', cause)
      }
    },
    capabilities: () => ({
      ttl: 'lazy',
      filter: 'native',
      watch: false,
      batch: true,
      mutate: 'cas',
    }),
    async close() {
      if (closeOwnedPool) await pool.end()
    },
  }
  return store
}

function now(): Date {
  return new Date(Date.now())
}

function escapeLike(prefix: string): string {
  return prefix.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function encodeCursor(key: string): string {
  return Buffer.from(JSON.stringify({ v: 1, key }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { v?: unknown }).v !== 1 ||
      typeof (parsed as { key?: unknown }).key !== 'string'
    ) {
      throw new Error('invalid')
    }
    return (parsed as { key: string }).key
  } catch {
    throw new StorageError('invalid_value', 'Record list cursor is invalid.')
  }
}

function assertVersion(version: string | null): void {
  if (version !== null && (!/^[1-9]\d*$/.test(version) || BigInt(version) > 9_223_372_036_854_775_807n)) {
    throw new StorageError('invalid_value', 'Record version is invalid.')
  }
}
