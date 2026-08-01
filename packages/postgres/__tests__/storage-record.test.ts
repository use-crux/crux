import { runConnectedKnowledgeConformance } from '@use-crux/core/knowledge'
import { mutateRecord } from '@use-crux/core/storage'
import { describeRecordStoreConformance } from '@use-crux/core/storage/testing/vitest'
import { afterAll, beforeAll, describe, expect, it, test, vi } from 'vitest'
import { postgresRecordStore } from '../src/index'
import { createPostgresTestPool, startPostgresTestDatabase, type PostgresTestDatabase } from './test-database'
import type { Pool } from 'pg'

let database: PostgresTestDatabase
let pool: Pool
const schemas: string[] = []

beforeAll(async () => {
  database = await startPostgresTestDatabase()
  pool = createPostgresTestPool(database.url)
})

afterAll(async () => {
  for (const schema of schemas) {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  }
  await pool.end()
  await database.close()
})

describeRecordStoreConformance({
  name: 'PostgreSQL',
  prepare: async () => await freshRecordStore(),
})

runConnectedKnowledgeConformance({
  createStorage: async () => ({ records: await freshRecordStore() }),
  test,
  expect,
})

describe('PostgreSQL RecordStore', () => {
  it('checks and applies setup explicitly and idempotently', async () => {
    const schema = nextSchema()
    const records = postgresRecordStore({ pool, schema })

    await expect(records.setup.check()).resolves.toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: 'POSTGRES_STORAGE_SCHEMA_MISSING' })],
    })
    await expect(records.setup.apply()).resolves.toEqual({ ok: true, findings: [] })
    await expect(records.setup.apply()).resolves.toEqual({ ok: true, findings: [] })
  })

  it('does not run hidden DDL from data operations', async () => {
    const records = postgresRecordStore({ pool, schema: nextSchema() })
    await expect(records.get('missing')).rejects.toMatchObject({
      code: 'backend_error',
      message: 'PostgreSQL storage read failed.',
    })
  })

  it('escapes wildcard characters in prefixes and paginates in key order', async () => {
    const records = await freshRecordStore()
    await records.putMany!([
      { key: String.raw`docs:%:a`, value: { n: 1 } },
      { key: String.raw`docs:_:a`, value: { n: 2 } },
      { key: String.raw`docs:\:a`, value: { n: 3 } },
      { key: 'docs:x:a', value: { n: 4 } },
    ])

    await expect(records.list('docs:%')).resolves.toMatchObject({
      entries: [{ key: 'docs:%:a', value: { n: 1 } }],
    })
    await expect(records.list('docs:_')).resolves.toMatchObject({
      entries: [{ key: 'docs:_:a', value: { n: 2 } }],
    })
    await expect(records.list('docs:\\')).resolves.toMatchObject({
      entries: [{ key: String.raw`docs:\:a`, value: { n: 3 } }],
    })

    const first = await records.list('docs:', { limit: 2 })
    const second = await records.list('docs:', { limit: 2, cursor: first.cursor })
    expect([...first.entries, ...second.entries].map(({ key }) => key)).toEqual([
      'docs:%:a',
      String.raw`docs:\:a`,
      'docs:_:a',
      'docs:x:a',
    ])
  })

  it('uses deterministic last-write-wins batches and preserves getMany order', async () => {
    const records = await freshRecordStore()
    await records.putMany!([
      { key: 'batch:a', value: { n: 1 } },
      { key: 'batch:b', value: { n: 2 } },
      { key: 'batch:a', value: { n: 3 } },
    ])
    await expect(records.getMany!(['batch:a', 'missing', 'batch:a', 'batch:b'])).resolves.toEqual([
      { n: 3 },
      null,
      { n: 3 },
      { n: 2 },
    ])
  })

  it('treats expired rows as absent for create and both CAS forms', async () => {
    const records = await freshRecordStore()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-02T00:00:00Z'))
      await records.put('ttl:key', { state: 'old' }, { ttlMs: 10 })
      const observed = await records.getVersioned!('ttl:key')
      vi.advanceTimersByTime(11)

      await expect(records.create('ttl:key', { state: 'created' })).resolves.toBe(true)
      await expect(records.putVersioned!('ttl:key', { state: 'stale' }, observed.version)).resolves.toBe(false)

      await records.put('ttl:key', { state: 'expired-again' }, { ttlMs: 10 })
      vi.advanceTimersByTime(11)
      await expect(records.putVersioned!('ttl:key', { state: 'cas' }, null)).resolves.toBe(true)
      await expect(records.get('ttl:key')).resolves.toEqual({ state: 'cas' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps concurrent CAS mutations linearizable', async () => {
    const records = await freshRecordStore()
    await records.put('counter', { count: 0 })
    await Promise.all(
      Array.from({ length: 12 }, () =>
        mutateRecord(
          records,
          'counter',
          (current) => ({
            type: 'put',
            value: { count: Number(current?.count ?? 0) + 1 },
          }),
          { maxAttempts: 40 },
        ),
      ),
    )
    await expect(records.get('counter')).resolves.toEqual({ count: 12 })
  })

  it('never closes a caller-owned pool', async () => {
    const records = await freshRecordStore()
    await records.close()
    await expect(pool.query('SELECT 1 AS ok')).resolves.toMatchObject({
      rows: [{ ok: 1 }],
    })
  })
})

async function freshRecordStore() {
  const records = postgresRecordStore({ pool, schema: nextSchema() })
  const result = await records.setup.apply()
  if (!result.ok) throw new Error(JSON.stringify(result.findings))
  return records
}

function nextSchema(): string {
  const schema = `crux_storage_test_${schemas.length}_${Math.random().toString(36).slice(2, 10)}`
  schemas.push(schema)
  return schema
}
