import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  SearchHit,
  SearchLegKind,
  SearchQuery,
  SearchRecord,
  SearchStoreCapabilities,
} from '@use-crux/core/storage'
import { createStorageConnection, type PostgresStorageConnection } from './connection'
import { createStorageSetup } from './setup'
import { backendError, storageTable, withStorageTransaction } from './sql'
import type { PostgresSearchStore, PostgresSearchStoreOptions, PostgresStorageSetup } from './types'
import {
  assertOptionalDimensions,
  assertKey,
  densePayloadSql,
  normalizeSearchQuery,
  normalizeSearchRecord,
  sparsePayloadSql,
  type NormalizedSearchLeg,
  type NormalizedSearchQuery,
  type SearchPayloadOptions,
} from './validation'

interface SearchRow {
  readonly key: string
  readonly score: number | string
  readonly metadata: ExactFilter
  readonly matches: readonly {
    readonly kind: SearchLegKind
    readonly rank: number | string
    readonly score: number | string
  }[]
}

interface BuiltSearchSql {
  readonly text: string
  readonly values: unknown[]
}

/** Create a PostgreSQL-backed SearchStore. */
export function postgresSearchStore(options: PostgresSearchStoreOptions): PostgresSearchStore {
  const payloads = normalizePayloadOptions(options)
  const connection = createStorageConnection(options)
  return createSearchStore(connection, payloads, lexicalConfiguration(options.lexical), connection.ownsPool)
}

export function createSearchStore(
  connection: PostgresStorageConnection,
  payloads: SearchPayloadOptions,
  lexicalConfig = 'simple',
  closeOwnedPool = false,
  setup: PostgresStorageSetup = createStorageSetup(connection.pool, connection.schema, {
    records: false,
    search: true,
    dimensions: payloads.dimensions,
    sparseDimensions: payloads.sparseDimensions,
    ...(payloads.lexical ? { lexicalConfiguration: lexicalConfig } : {}),
  }),
): PostgresSearchStore {
  const { pool, schema } = connection
  const table = storageTable(schema, 'search')
  const capabilities = deriveCapabilities(payloads)

  return {
    _tag: 'SearchStore',
    setup,
    async upsert(records: readonly SearchRecord[]) {
      const normalized = records.map((record) => normalizeSearchRecord(record, payloads))
      if (normalized.length === 0) return
      try {
        await withStorageTransaction(pool, async (client) => {
          for (const record of normalized) {
            const columns = ['key', ...payloadColumns(payloads), 'metadata']
            const values = [
              record.key,
              ...payloadValues(record, payloads),
              JSON.stringify(record.metadata),
            ]
            const placeholders = columns.map((column, index) => {
              const parameter = `$${index + 1}`
              if (column === 'dense') return `${parameter}::vector`
              if (column === 'sparse') return `${parameter}::sparsevec`
              if (column === 'metadata') return `${parameter}::jsonb`
              return parameter
            })
            const updates = columns
              .filter((column) => column !== 'key')
              .map((column) => `${column} = EXCLUDED.${column}`)
              .join(',\n                   ')
            await client.query(
              `INSERT INTO ${table} (${columns.join(', ')})
               VALUES (${placeholders.join(', ')})
               ON CONFLICT (key) DO UPDATE SET
                 ${updates}`,
              values,
            )
          }
        })
      } catch (cause) {
        backendError('search upsert', cause)
      }
    },
    async delete(keys: readonly string[]) {
      keys.forEach((key) => assertKey(key, 'Search'))
      if (keys.length === 0) return
      try {
        await pool.query(`DELETE FROM ${table} WHERE key = ANY($1::text[])`, [[...new Set(keys)]])
      } catch (cause) {
        backendError('search delete', cause)
      }
    },
    async search(query: SearchQuery) {
      const normalized = normalizeSearchQuery(query, payloads, capabilities)
      if (normalized.limit === 0) return []
      try {
        const sql = buildSearchSql(table, normalized, payloads, lexicalConfig)
        const result = await pool.query<SearchRow>(sql.text, sql.values)
        return result.rows.map(searchHit)
      } catch (cause) {
        if (isInvalidRegconfig(cause)) {
          throw new StorageError('invalid_value', 'PostgreSQL text-search configuration is invalid or unavailable.', {
            cause,
          })
        }
        return backendError('search', cause)
      }
    },
    capabilities: () => capabilities,
    async close() {
      if (closeOwnedPool) await pool.end()
    },
  }
}

function normalizePayloadOptions(options: PostgresSearchStoreOptions): SearchPayloadOptions {
  assertOptionalDimensions(options?.dimensions, 'PostgreSQL dense dimensions')
  assertOptionalDimensions(options?.sparseDimensions, 'PostgreSQL sparse dimensions')
  const lexical = options?.lexical !== undefined
  if (options?.dimensions === undefined && options?.sparseDimensions === undefined && !lexical) {
    throw new StorageError(
      'invalid_value',
      'PostgreSQL search storage requires dimensions, sparseDimensions, or lexical search.',
    )
  }
  return {
    ...(options.dimensions !== undefined ? { dimensions: options.dimensions } : {}),
    ...(options.sparseDimensions !== undefined ? { sparseDimensions: options.sparseDimensions } : {}),
    lexical,
  }
}

function lexicalConfiguration(value: PostgresSearchStoreOptions['lexical']): string {
  if (value === undefined) return 'simple'
  if (value === true || value.configuration === undefined) return 'simple'
  if (typeof value.configuration !== 'string' || value.configuration.length === 0 || value.configuration.includes('\0')) {
    throw new StorageError('invalid_value', 'PostgreSQL text-search configuration must be a non-empty string.')
  }
  return value.configuration
}

function deriveCapabilities(payloads: SearchPayloadOptions): SearchStoreCapabilities {
  const enabled = [payloads.dimensions !== undefined, payloads.sparseDimensions !== undefined, payloads.lexical].filter(
    Boolean,
  ).length
  return Object.freeze({
    legs: Object.freeze({
      dense: payloads.dimensions !== undefined,
      sparse: payloads.sparseDimensions !== undefined,
      lexical: payloads.lexical,
    }),
    fusion: enabled >= 2 ? (['rrf'] as const) : [],
    filter: 'pre',
    consistency: 'strong',
  })
}

function payloadColumns(payloads: SearchPayloadOptions): readonly string[] {
  return [
    ...(payloads.dimensions === undefined ? [] : ['dense']),
    ...(payloads.sparseDimensions === undefined ? [] : ['sparse']),
    ...(payloads.lexical ? ['content'] : []),
  ]
}

function payloadValues(record: SearchRecord, payloads: SearchPayloadOptions): readonly (string | null)[] {
  return [
    ...(payloads.dimensions === undefined ? [] : [record.dense ? densePayloadSql(record.dense) : null]),
    ...(payloads.sparseDimensions === undefined
      ? []
      : [record.sparse ? sparsePayloadSql(record.sparse, payloads.sparseDimensions) : null]),
    ...(payloads.lexical ? [record.content ?? null] : []),
  ]
}

function buildSearchSql(
  table: string,
  query: NormalizedSearchQuery,
  payloads: SearchPayloadOptions,
  lexicalConfig: string,
): BuiltSearchSql {
  const values: unknown[] = []
  const filter = query.filter ? parameter(values, JSON.stringify(query.filter)) : 'NULL'
  const legCtes = query.legs.map((leg, index) => buildCandidateCte(table, leg, index, values, filter, payloads, lexicalConfig))
  const aliases = query.legs.map((_, index) => `c${index}`)
  const from = buildJoinedCandidates(aliases)
  const key = coalesce(aliases, 'key')
  const metadata = coalesce(aliases, 'metadata')
  const score = query.legs.length === 1 ? `${aliases[0]}.score` : rrfScore(aliases, parameter(values, query.fusion!.k))
  const threshold = parameter(values, query.threshold)
  const limit = parameter(values, query.limit)
  const matches = aliases
    .map(
      (alias, index) =>
        `(${index + 1}, CASE WHEN ${alias}.rank IS NULL THEN NULL ELSE jsonb_build_object('kind', '${query.legs[index]!.kind}', 'rank', ${alias}.rank, 'score', ${alias}.score) END)`,
    )
    .join(',\n             ')

  return {
    text: `WITH ${legCtes.join(',\n     ')},
     scored AS (
       SELECT
         ${key} AS key,
         ${metadata} AS metadata,
         ${score} AS score,
         (
           SELECT coalesce(jsonb_agg(match ORDER BY ordinal), '[]'::jsonb)
           FROM (VALUES
             ${matches}
           ) AS leg_matches(ordinal, match)
           WHERE match IS NOT NULL
         ) AS matches
       FROM ${from}
     )
     SELECT key, metadata, score, matches
     FROM scored
     WHERE score >= ${threshold}
     ORDER BY score DESC, key ASC
     LIMIT ${limit}`,
    values,
  }
}

function buildCandidateCte(
  table: string,
  leg: NormalizedSearchLeg,
  index: number,
  values: unknown[],
  filter: string,
  payloads: SearchPayloadOptions,
  lexicalConfig: string,
): string {
  const name = `candidates_${index}`
  const candidateLimit = parameter(values, leg.candidates)
  if (leg.kind === 'dense') {
    const vector = parameter(values, densePayloadSql(leg.dense!))
    return `${name} AS (
       SELECT key, metadata, score,
         row_number() OVER (ORDER BY score DESC, key ASC) AS rank
       FROM (
         SELECT key, metadata, 1 - (dense <=> ${vector}::vector) AS score
         FROM ${table}
         WHERE dense IS NOT NULL
           AND (${filter}::jsonb IS NULL OR metadata @> ${filter}::jsonb)
         ORDER BY dense <=> ${vector}::vector ASC, key ASC
         LIMIT ${candidateLimit}
       ) ranked_dense
     )`
  }
  if (leg.kind === 'sparse') {
    const vector = parameter(values, sparsePayloadSql(leg.sparse!, payloads.sparseDimensions!))
    return `${name} AS (
       SELECT key, metadata, score,
         row_number() OVER (ORDER BY score DESC, key ASC) AS rank
       FROM (
         SELECT key, metadata, 1 - (sparse <=> ${vector}::sparsevec) AS score
         FROM ${table}
         WHERE sparse IS NOT NULL
           AND (${filter}::jsonb IS NULL OR metadata @> ${filter}::jsonb)
         ORDER BY sparse <=> ${vector}::sparsevec ASC, key ASC
         LIMIT ${candidateLimit}
       ) ranked_sparse
     )`
  }
  const configuration = parameter(values, lexicalConfig)
  const query = parameter(values, leg.lexical)
  return `${name} AS (
     SELECT key, metadata, score,
       row_number() OVER (ORDER BY score DESC, key ASC) AS rank
     FROM (
       SELECT s.key, s.metadata, ts_rank_cd(s.search_document, q.tsquery) AS score
       FROM ${table} s
       CROSS JOIN (SELECT websearch_to_tsquery(${configuration}::regconfig, ${query}) AS tsquery) q
       WHERE s.search_document IS NOT NULL
         AND s.search_document @@ q.tsquery
         AND (${filter}::jsonb IS NULL OR s.metadata @> ${filter}::jsonb)
       ORDER BY score DESC, s.key ASC
       LIMIT ${candidateLimit}
     ) ranked_lexical
   )`
}

function buildJoinedCandidates(aliases: readonly string[]): string {
  let from = `candidates_0 ${aliases[0]}`
  for (let index = 1; index < aliases.length; index += 1) {
    const leftKey = coalesce(aliases.slice(0, index), 'key')
    from += `\n       FULL OUTER JOIN candidates_${index} ${aliases[index]} ON ${aliases[index]}.key = ${leftKey}`
  }
  return from
}

function rrfScore(aliases: readonly string[], k: string): string {
  const terms = aliases.map((alias) => `CASE WHEN ${alias}.rank IS NULL THEN 0 ELSE 1.0 / (${k} + ${alias}.rank) END`)
  return `((${terms.join(' + ')}) * ((${k} + 1.0) / ${aliases.length}.0))`
}

function coalesce(aliases: readonly string[], column: 'key' | 'metadata'): string {
  return aliases.length === 1
    ? `${aliases[0]}.${column}`
    : `COALESCE(${aliases.map((alias) => `${alias}.${column}`).join(', ')})`
}

function parameter(values: unknown[], value: unknown): string {
  values.push(value)
  return `$${values.length}`
}

function searchHit(row: SearchRow): SearchHit {
  const metadata = row.metadata ?? {}
  return {
    key: row.key,
    score: Number(row.score),
    ...(Object.keys(metadata).length > 0 ? { metadata: { ...metadata } } : {}),
    matches: row.matches.map((match) => ({
      kind: match.kind,
      rank: Number(match.rank),
      score: Number(match.score),
    })),
  }
}

function isInvalidRegconfig(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    ('code' in cause || 'routine' in cause) &&
    ((cause as { code?: unknown }).code === '42704' || (cause as { routine?: unknown }).routine === 'regconfigin')
  )
}
