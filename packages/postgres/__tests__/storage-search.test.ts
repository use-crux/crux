import { StorageError } from '@use-crux/core/storage'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { postgresSearchStore, postgresStorage } from '../src/index'
import { createPostgresTestPool, startPostgresTestDatabase, type PostgresTestDatabase } from './test-database'

let database: PostgresTestDatabase
let lexicalPool: Pool
const lexicalSchemas: string[] = []

beforeAll(async () => {
  database = await startPostgresTestDatabase()
  lexicalPool = createPostgresTestPool(database.url)
})

afterAll(async () => {
  for (const schema of lexicalSchemas) {
    await lexicalPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  }
  await lexicalPool.end()
  await database.close()
})

describe('PostgreSQL SearchStore lexical storage', () => {
  it('projects lexical-only capabilities and applies setup idempotently', async () => {
    const schema = nextLexicalSchema()
    const search = postgresSearchStore({ pool: lexicalPool, schema, lexical: true })

    expect(search.capabilities()).toEqual({
      legs: { dense: false, sparse: false, lexical: true },
      fusion: [],
      filter: 'pre',
      consistency: 'strong',
    })
    await expect(search.setup.check()).resolves.toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: 'POSTGRES_STORAGE_SCHEMA_MISSING' })],
    })
    await expect(search.setup.apply()).resolves.toEqual({ ok: true, findings: [] })
    await expect(search.setup.apply()).resolves.toEqual({ ok: true, findings: [] })

    const indexes = await lexicalPool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
      [schema],
    )
    expect(indexes.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ indexname: 'search_document_gin_idx', indexdef: expect.stringContaining('gin') }),
        expect.objectContaining({ indexname: 'search_metadata_gin_idx', indexdef: expect.stringContaining('gin') }),
      ]),
    )
  })

  it('stores content, prefilters, ranks lexical matches, and deletes by key', async () => {
    const search = await freshLexicalSearch()
    await search.upsert([
      { key: 'a', content: 'transaction retry semantics', metadata: { tenant: 'acme' } },
      { key: 'b', content: 'transaction lock timeout', metadata: { tenant: 'acme' } },
      { key: 'c', content: 'transaction retry semantics', metadata: { tenant: 'other' } },
    ] as never)

    const hits = await search.search({
      legs: [{ kind: 'lexical', query: 'transaction' }],
      filter: { tenant: 'acme' },
      limit: 2,
    } as never)
    expect(hits.map(({ key }) => key)).toEqual(['a', 'b'])
    expect(hits[0]!.matches).toEqual([{ kind: 'lexical', rank: 1, score: expect.any(Number) }])
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score)

    await search.delete(['a'])
    await expect(
      search.search({ legs: [{ kind: 'lexical', query: 'transaction retry' }], limit: 3 } as never),
    ).resolves.toEqual([expect.objectContaining({ key: 'c' })])
  })

  it('returns punctuation-only lexical queries as no matches', async () => {
    const search = await freshLexicalSearch()
    await search.upsert([{ key: 'a', content: 'plain searchable content' }] as never)
    await expect(search.search({ legs: [{ kind: 'lexical', query: '!!!' }] } as never)).resolves.toEqual([])
  })

  it('reports invalid text-search configurations before applying DDL', async () => {
    const search = postgresSearchStore({
      pool: lexicalPool,
      schema: nextLexicalSchema(),
      lexical: { configuration: 'not_a_real_config' },
    })
    await expect(search.setup.apply()).resolves.toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: 'POSTGRES_SEARCH_CONFIGURATION_INVALID' })],
    })
  })

  it('shares one setup lifecycle through storage.search and leaves caller pools open', async () => {
    const storage = postgresStorage({ pool: lexicalPool, schema: nextLexicalSchema(), lexical: true })
    expect((storage.records as { setup?: unknown }).setup).toBe(storage.setup)
    expect((storage.search as { setup?: unknown }).setup).toBe(storage.setup)
    await storage.close()
    await expect(lexicalPool.query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] })
  })
})

const pgvectorUrl = process.env.CRUX_TEST_PGVECTOR_URL

if (!pgvectorUrl) {
  describe('PostgreSQL SearchStore pgvector integration', () => {
    it.skip('requires CRUX_TEST_PGVECTOR_URL pointing to PostgreSQL with pgvector', () => {})
  })
} else {
  const pool = new Pool({ connectionString: pgvectorUrl })
  const schemas: string[] = []

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    }
    await pool.end()
  })

  describe('PostgreSQL SearchStore dense, sparse, and fused search', () => {
    it('projects capabilities from configured search payloads', () => {
      const dense = postgresSearchStore({ pool, schema: nextSchema(), dimensions: 2 })
      const full = postgresSearchStore({
        pool,
        schema: nextSchema(),
        dimensions: 2,
        sparseDimensions: 8,
        lexical: true,
      })
      expect(dense.capabilities()).toEqual({
        legs: { dense: true, sparse: false, lexical: false },
        fusion: [],
        filter: 'pre',
        consistency: 'strong',
      })
      expect(full.capabilities()).toEqual({
        legs: { dense: true, sparse: true, lexical: true },
        fusion: ['rrf'],
        filter: 'pre',
        consistency: 'strong',
      })
    })

    it('creates configured search payload indexes', async () => {
      const schema = nextSchema()
      const search = postgresSearchStore({ pool, schema, dimensions: 2, sparseDimensions: 8, lexical: true })
      await expect(search.setup.apply()).resolves.toEqual({ ok: true, findings: [] })
      await expect(search.setup.check()).resolves.toEqual({ ok: true, findings: [] })
      const indexes = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
        [schema],
      )
      expect(indexes.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ indexname: 'search_dense_hnsw_idx', indexdef: expect.stringContaining('hnsw') }),
          expect.objectContaining({ indexname: 'search_sparse_hnsw_idx', indexdef: expect.stringContaining('hnsw') }),
          expect.objectContaining({ indexname: 'search_document_gin_idx', indexdef: expect.stringContaining('gin') }),
          expect.objectContaining({ indexname: 'search_metadata_gin_idx', indexdef: expect.stringContaining('gin') }),
        ]),
      )
    })

    it('runs multi-leg normalized RRF with match details, filters, and stable ties', async () => {
      const search = await freshSearch()
      await search.upsert([
        {
          key: 'a',
          content: 'transaction retry semantics',
          dense: [1, 0],
          sparse: { indices: [0], values: [1] },
          metadata: { tenant: 'acme' },
        },
        {
          key: 'b',
          content: 'transaction lock timeout',
          dense: [0.9, 0.1],
          sparse: { indices: [1], values: [1] },
          metadata: { tenant: 'acme' },
        },
        {
          key: 'c',
          content: 'transaction retry semantics',
          dense: [1, 0],
          sparse: { indices: [0], values: [1] },
          metadata: { tenant: 'other' },
        },
      ] as never)

      const hits = await search.search({
        legs: [
          { kind: 'lexical', query: 'transaction retry', candidates: 2 },
          { kind: 'dense', vector: [1, 0], candidates: 2 },
          { kind: 'sparse', vector: { indices: [0], values: [1] }, candidates: 2 },
        ],
        fusion: { strategy: 'rrf', k: 30 },
        filter: { tenant: 'acme' },
        threshold: 0.3,
        limit: 2,
      } as never)

      expect(hits.map(({ key }) => key)).toEqual(['a', 'b'])
      expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
      expect(hits.every(({ score }) => score >= 0 && score <= 1)).toBe(true)
      expect(hits[0]!.matches.map(({ kind }) => kind)).toEqual(['lexical', 'dense', 'sparse'])
    })

    it('clears omitted payloads during full-record replacement upsert', async () => {
      const search = await freshSearch()
      await search.upsert([
        {
          key: 'a',
          content: 'transaction retry semantics',
          dense: [1, 0],
          sparse: { indices: [0], values: [1] },
        },
      ] as never)
      await search.upsert([{ key: 'a', dense: [1, 0] }] as never)

      await expect(search.search({ legs: [{ kind: 'lexical', query: 'transaction' }], limit: 1 } as never)).resolves.toEqual(
        [],
      )
      await expect(search.search({ legs: [{ kind: 'dense', vector: [1, 0] }], limit: 1 } as never)).resolves.toEqual([
        expect.objectContaining({ key: 'a' }),
      ])
    })

    it('rejects invalid dense and sparse payloads before backend I/O', async () => {
      const search = postgresSearchStore({ pool, schema: nextSchema(), dimensions: 2, sparseDimensions: 4 })
      await expect(search.upsert([{ key: 'bad', dense: [1] }] as never)).rejects.toBeInstanceOf(StorageError)
      await expect(search.upsert([{ key: 'bad', sparse: { indices: [4], values: [1] } }] as never)).rejects.toMatchObject({
        code: 'invalid_value',
      })
      await expect(
        search.upsert([{ key: 'bad', sparse: { indices: [1, 1], values: [1, 2] } }] as never),
      ).rejects.toMatchObject({ code: 'invalid_value' })
    })
  })

  async function freshSearch() {
    const search = postgresSearchStore({
      pool,
      schema: nextSchema(),
      dimensions: 2,
      sparseDimensions: 8,
      lexical: true,
    })
    const result = await search.setup.apply()
    if (!result.ok) throw new Error(JSON.stringify(result.findings))
    return search
  }

  function nextSchema(): string {
    const schema = `crux_search_test_${schemas.length}_${Math.random().toString(36).slice(2, 10)}`
    schemas.push(schema)
    return schema
  }
}

async function freshLexicalSearch() {
  const search = postgresSearchStore({ pool: lexicalPool, schema: nextLexicalSchema(), lexical: true })
  const result = await search.setup.apply()
  if (!result.ok) throw new Error(JSON.stringify(result.findings))
  return search
}

function nextLexicalSchema(): string {
  const schema = `crux_lexical_test_${lexicalSchemas.length}_${Math.random().toString(36).slice(2, 10)}`
  lexicalSchemas.push(schema)
  return schema
}
