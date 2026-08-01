import type { ExactFilter, VectorHit, VectorRecord, VectorStoreCapabilities } from '@use-crux/core/storage'
import { createStorageConnection, type PostgresStorageConnection } from './connection'
import { createStorageSetup } from './setup'
import { backendError, storageTable, withStorageTransaction } from './sql'
import type { PostgresStorageSetup, PostgresVectorStore, PostgresVectorStoreOptions } from './types'
import {
  assertDimensions,
  assertKey,
  denseVectorSql,
  normalizeVectorQuery,
  normalizeVectorRecord,
  sparseVectorSql,
  type NormalizedVectorQuery,
} from './validation'

interface VectorRow {
  readonly key: string
  readonly score: number | string
  readonly metadata: ExactFilter
}

/** Create a PostgreSQL/pgvector-backed VectorStore. */
export function postgresVectorStore(options: PostgresVectorStoreOptions): PostgresVectorStore {
  assertDimensions(options?.dimensions, 'PostgreSQL dense dimensions')
  if (options.sparseDimensions !== undefined) {
    assertDimensions(options.sparseDimensions, 'PostgreSQL sparse dimensions')
  }
  const connection = createStorageConnection(options)
  return createVectorStore(connection, options.dimensions, options.sparseDimensions, connection.ownsPool)
}

export function createVectorStore(
  connection: PostgresStorageConnection,
  dimensions: number,
  sparseDimensions: number | undefined,
  closeOwnedPool = false,
  setup: PostgresStorageSetup = createStorageSetup(connection.pool, connection.schema, {
    records: false,
    vectors: true,
    dimensions,
    sparseDimensions,
  }),
): PostgresVectorStore {
  const { pool, schema } = connection
  const table = storageTable(schema, 'vectors')
  const capabilities: VectorStoreCapabilities = Object.freeze({
    dense: true,
    sparse: sparseDimensions !== undefined,
    hybrid: sparseDimensions !== undefined,
    fusion: sparseDimensions === undefined ? [] : (['rrf'] as const),
    filter: 'pre',
    consistency: 'strong',
  })

  return {
    _tag: 'VectorStore',
    setup,
    async upsert(records: readonly VectorRecord[]) {
      const normalized = records.map((record) => normalizeVectorRecord(record, dimensions, sparseDimensions))
      if (normalized.length === 0) return
      try {
        await withStorageTransaction(pool, async (client) => {
          for (const record of normalized) {
            if (sparseDimensions === undefined) {
              await client.query(
                `INSERT INTO ${table} (key, dense, metadata)
                 VALUES ($1, $2::vector, $3::jsonb)
                 ON CONFLICT (key) DO UPDATE SET
                   dense = EXCLUDED.dense,
                   metadata = EXCLUDED.metadata`,
                [record.key, denseVectorSql(record.dense!), JSON.stringify(record.metadata)],
              )
            } else {
              await client.query(
                `INSERT INTO ${table} (key, dense, sparse, metadata)
                 VALUES ($1, $2::vector, $3::sparsevec, $4::jsonb)
                 ON CONFLICT (key) DO UPDATE SET
                   dense = EXCLUDED.dense,
                   sparse = EXCLUDED.sparse,
                   metadata = EXCLUDED.metadata`,
                [
                  record.key,
                  record.dense ? denseVectorSql(record.dense) : null,
                  record.sparse ? sparseVectorSql(record.sparse, sparseDimensions) : null,
                  JSON.stringify(record.metadata),
                ],
              )
            }
          }
        })
      } catch (cause) {
        backendError('vector upsert', cause)
      }
    },
    async delete(keys) {
      keys.forEach((key) => assertKey(key, 'Vector'))
      if (keys.length === 0) return
      try {
        await pool.query(`DELETE FROM ${table} WHERE key = ANY($1::text[])`, [[...new Set(keys)]])
      } catch (cause) {
        backendError('vector delete', cause)
      }
    },
    async search(query) {
      const normalized = normalizeVectorQuery(query, dimensions, sparseDimensions, capabilities)
      if (normalized.limit === 0) return []
      try {
        const rows =
          normalized.mode === 'hybrid'
            ? await searchHybrid(table, normalized, sparseDimensions!)
            : await searchSingle(table, normalized, sparseDimensions)
        return rows.map(vectorHit)
      } catch (cause) {
        return backendError('vector search', cause)
      }
    },
    capabilities: () => capabilities,
    async close() {
      if (closeOwnedPool) await pool.end()
    },
  }

  async function searchSingle(
    tableName: string,
    query: NormalizedVectorQuery,
    sparseWidth: number | undefined,
  ): Promise<readonly VectorRow[]> {
    const dense = query.mode === 'dense'
    const column = dense ? 'dense' : 'sparse'
    const cast = dense ? 'vector' : 'sparsevec'
    const vector = dense ? denseVectorSql(query.dense!) : sparseVectorSql(query.sparse!, sparseWidth!)
    const filter = query.filter ? JSON.stringify(query.filter) : null
    const result = await pool.query<VectorRow>(
      `SELECT key, metadata, 1 - (${column} <=> $1::${cast}) AS score
       FROM ${tableName}
       WHERE ${column} IS NOT NULL
         AND ($2::jsonb IS NULL OR metadata @> $2::jsonb)
         AND 1 - (${column} <=> $1::${cast}) >= $3
       ORDER BY ${column} <=> $1::${cast} ASC, key ASC
       LIMIT $4`,
      [vector, filter, query.threshold, query.limit],
    )
    return result.rows
  }

  async function searchHybrid(
    tableName: string,
    query: NormalizedVectorQuery,
    sparseWidth: number,
  ): Promise<readonly VectorRow[]> {
    const depth = Math.min(1000, Math.max(50, 4 * query.limit))
    const filter = query.filter ? JSON.stringify(query.filter) : null
    const result = await pool.query<VectorRow>(
      `WITH dense_candidates AS (
         SELECT key, metadata,
           row_number() OVER (ORDER BY dense <=> $1::vector ASC, key ASC) AS rank
         FROM ${tableName}
         WHERE dense IS NOT NULL
           AND ($3::jsonb IS NULL OR metadata @> $3::jsonb)
         ORDER BY dense <=> $1::vector ASC, key ASC
         LIMIT $4
       ), sparse_candidates AS (
         SELECT key, metadata,
           row_number() OVER (ORDER BY sparse <=> $2::sparsevec ASC, key ASC) AS rank
         FROM ${tableName}
         WHERE sparse IS NOT NULL
           AND ($3::jsonb IS NULL OR metadata @> $3::jsonb)
         ORDER BY sparse <=> $2::sparsevec ASC, key ASC
         LIMIT $4
       ), fused AS (
         SELECT
           COALESCE(d.key, s.key) AS key,
           COALESCE(d.metadata, s.metadata) AS metadata,
           (
             CASE WHEN d.rank IS NULL THEN 0 ELSE 1.0 / (60 + d.rank) END +
             CASE WHEN s.rank IS NULL THEN 0 ELSE 1.0 / (60 + s.rank) END
           ) / (2.0 / 61.0) AS score
         FROM dense_candidates d
         FULL OUTER JOIN sparse_candidates s ON s.key = d.key
       )
       SELECT key, metadata, score FROM fused
       WHERE score >= $5
       ORDER BY score DESC, key ASC
       LIMIT $6`,
      [
        denseVectorSql(query.dense!),
        sparseVectorSql(query.sparse!, sparseWidth),
        filter,
        depth,
        query.threshold,
        query.limit,
      ],
    )
    return result.rows
  }
}

function vectorHit(row: VectorRow): VectorHit {
  const metadata = row.metadata ?? {}
  return {
    key: row.key,
    score: Number(row.score),
    ...(Object.keys(metadata).length > 0 ? { metadata: { ...metadata } } : {}),
  }
}
