import { runConnectedKnowledgeConformance } from '@use-crux/core/knowledge'
import { StorageError } from '@use-crux/core/storage'
import { describeVectorStoreConformance, vectorStoreConformanceSuite } from '@use-crux/core/storage/testing/vitest'
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'
import { Pool } from 'pg'
import { postgresStorage, postgresVectorStore } from '../src/index'

const pgvectorUrl = process.env.CRUX_TEST_PGVECTOR_URL

if (!pgvectorUrl) {
  describe('PostgreSQL pgvector integration', () => {
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

  describeVectorStoreConformance({
    name: 'PostgreSQL pgvector',
    prepare: async () => (await freshStorage()).vectors,
  })

  vectorStoreConformanceSuite({
    name: 'PostgreSQL pgvector',
    capabilities: { sparse: true, hybrid: true, delete: true },
    create: async () => {
      const storage = await freshStorage()
      return {
        records: storage.records,
        vectors: storage.vectors,
        async cleanup() {},
      }
    },
  })

  runConnectedKnowledgeConformance({
    createStorage: async () => await freshStorage(),
    test,
    expect,
  })

  describe('PostgreSQL pgvector focused behavior', () => {
    it('projects capabilities exactly from sparseDimensions', () => {
      const dense = postgresVectorStore({ pool, schema: nextSchema(), dimensions: 2 })
      const hybrid = postgresVectorStore({
        pool,
        schema: nextSchema(),
        dimensions: 2,
        sparseDimensions: 8,
      })
      expect(dense.capabilities()).toEqual({
        dense: true,
        sparse: false,
        hybrid: false,
        fusion: [],
        filter: 'pre',
        consistency: 'strong',
      })
      expect(hybrid.capabilities()).toEqual({
        dense: true,
        sparse: true,
        hybrid: true,
        fusion: ['rrf'],
        filter: 'pre',
        consistency: 'strong',
      })
    })

    it('creates and verifies configured HNSW and metadata indexes', async () => {
      const schema = nextSchema()
      const vectors = postgresVectorStore({
        pool,
        schema,
        dimensions: 2,
        sparseDimensions: 8,
      })
      await expect(vectors.setup.apply()).resolves.toEqual({ ok: true, findings: [] })
      await expect(vectors.setup.check()).resolves.toEqual({ ok: true, findings: [] })
      const indexes = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
        [schema],
      )
      expect(indexes.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ indexname: 'vectors_dense_hnsw_idx', indexdef: expect.stringContaining('hnsw') }),
          expect.objectContaining({ indexname: 'vectors_sparse_hnsw_idx', indexdef: expect.stringContaining('hnsw') }),
          expect.objectContaining({ indexname: 'vectors_metadata_gin_idx', indexdef: expect.stringContaining('gin') }),
        ]),
      )
    })

    it('ranks sparse and hybrid RRF results with prefilters and stable ties', async () => {
      const { vectors } = await freshStorage()
      await vectors.upsert([
        { key: 'a', dense: [1, 0], sparse: { indices: [0], values: [1] }, metadata: { tenant: 'a' } },
        { key: 'b', dense: [0.9, 0.1], sparse: { indices: [1], values: [1] }, metadata: { tenant: 'a' } },
        { key: 'c', dense: [1, 0], sparse: { indices: [0], values: [1] }, metadata: { tenant: 'b' } },
      ])

      const hits = await vectors.search({
        mode: 'hybrid',
        dense: [1, 0],
        sparse: { indices: [0], values: [1] },
        fusion: 'rrf',
        filter: { tenant: 'a' },
        threshold: 0.49,
        limit: 2,
      })
      expect(hits.map(({ key }) => key)).toEqual(['a', 'b'])
      expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
      expect(hits.every(({ score }) => score >= 0 && score <= 1)).toBe(true)
    })

    it('returns limit zero without querying a missing table and rejects DBSF', async () => {
      const vectors = postgresVectorStore({
        pool,
        schema: nextSchema(),
        dimensions: 2,
        sparseDimensions: 8,
      })
      await expect(vectors.search({ mode: 'dense', dense: [1, 0], limit: 0 })).resolves.toEqual([])
      await expect(
        vectors.search({
          mode: 'hybrid',
          dense: [1, 0],
          sparse: { indices: [0], values: [1] },
          fusion: 'dbsf',
        }),
      ).rejects.toMatchObject({ code: 'unsupported_capability' })
    })

    it('rejects exact-width and sparse-bound violations before backend I/O', async () => {
      const vectors = postgresVectorStore({
        pool,
        schema: nextSchema(),
        dimensions: 2,
        sparseDimensions: 4,
      })
      await expect(vectors.upsert([{ key: 'bad', dense: [1] }])).rejects.toBeInstanceOf(StorageError)
      await expect(vectors.upsert([{ key: 'bad', sparse: { indices: [4], values: [1] } }])).rejects.toMatchObject({
        code: 'invalid_value',
      })
      await expect(vectors.upsert([{ key: 'bad', sparse: { indices: [1, 1], values: [1, 2] } }])).rejects.toMatchObject(
        { code: 'invalid_value' },
      )
    })
  })

  async function freshStorage() {
    const storage = postgresStorage({
      pool,
      schema: nextSchema(),
      dimensions: 2,
      sparseDimensions: 8,
    })
    const result = await storage.setup.apply()
    if (!result.ok) throw new Error(JSON.stringify(result.findings))
    return storage
  }

  function nextSchema(): string {
    const schema = `crux_vector_test_${schemas.length}_${Math.random().toString(36).slice(2, 10)}`
    schemas.push(schema)
    return schema
  }
}
