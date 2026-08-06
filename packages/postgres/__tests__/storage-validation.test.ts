import { StorageError, type StorageSetupPort } from '@use-crux/core/storage'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { postgresRecordStore, postgresSearchStore, postgresStorage } from '../src/index'
import { normalizeSearchRecord, sparsePayloadSql } from '../src/storage/validation'

describe('PostgreSQL storage validation and SQL shaping', () => {
  it('requires positive configured dimensions', () => {
    const pool = fakePool()
    expect(() => postgresSearchStore({ pool, dimensions: 0 })).toThrow(StorageError)
    expect(() => postgresSearchStore({ pool, dimensions: 2, sparseDimensions: -1 })).toThrow(StorageError)
    expect(() => postgresSearchStore({ pool })).toThrow(StorageError)
  })

  it('converts zero-based sparse indices to sorted one-based sparsevec text', () => {
    expect(sparsePayloadSql({ indices: [4, 0, 2], values: [5, 1, 3] }, 8)).toBe('{1:1,3:3,5:5}/8')
  })

  it('accepts indexed content when lexical storage is disabled', () => {
    expect(
      normalizeSearchRecord(
        { key: 'docs:a', content: 'Stored for lexical-capable adapters.', dense: [1, 0] },
        { dimensions: 2, lexical: false },
      ),
    ).toMatchObject({ key: 'docs:a', content: 'Stored for lexical-capable adapters.', dense: [1, 0] })
  })

  it('validates record JSON, filters, keys, TTL, cursors, and options before SQL', async () => {
    const pool = fakePool()
    const records = postgresRecordStore({ pool })
    await expect(records.get('')).rejects.toMatchObject({ code: 'invalid_key' })
    await expect(records.put('x', { bad: Number.NaN })).rejects.toMatchObject({ code: 'invalid_value' })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(records.put('x', cyclic as never)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(records.put('x', { ok: true }, { ttlMs: 0 })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(records.list('x', { limit: -1 })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(records.list('x', { cursor: 'not-a-cursor' })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(records.list('x', { filter: { nested: {} } as never })).rejects.toMatchObject({
      code: 'invalid_filter',
    })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('validates search payloads and returns limit zero before SQL', async () => {
    const pool = fakePool()
    const search = postgresSearchStore({ pool, dimensions: 2, sparseDimensions: 4 })
    await expect(search.upsert([{ key: 'bad', dense: [1] }] as never)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(search.upsert([{ key: 'bad', sparse: { indices: [4], values: [1] } }] as never)).rejects.toMatchObject({
      code: 'invalid_value',
    })
    await expect(search.search({ legs: [{ kind: 'dense', vector: [1, 0] }], limit: 0 } as never)).resolves.toEqual([])
    await expect(
      search.search({
        legs: [
          { kind: 'dense', vector: [1, 0] },
          { kind: 'sparse', vector: { indices: [0], values: [1] } },
        ],
        fusion: { strategy: 'dbsf' },
      } as never),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    await expect(search.search({ legs: [{ kind: 'lexical', query: 'missing' }] } as never)).rejects.toMatchObject({
      code: 'unsupported_capability',
    })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('shares one setup lifecycle and leaves caller pools open', async () => {
    const pool = fakePool()
    const storage = postgresStorage({ pool, dimensions: 2 })
    expect((storage.records as { setup?: unknown }).setup).toBe(storage.setup)
    expect((storage.search as { setup?: unknown }).setup).toBe(storage.setup)
    expectTypeOf(storage.setup).toEqualTypeOf<StorageSetupPort>()
    await storage.close()
    expect(pool.end).not.toHaveBeenCalled()
  })

  it('redacts setup failures', async () => {
    const pool = fakePool()
    pool.query.mockRejectedValue(new Error('postgres://user:secret@private-host/db'))
    const records = postgresRecordStore({ pool })
    const result = await records.setup.check()
    expect(result).toMatchObject({
      ok: false,
      findings: [{ code: 'POSTGRES_STORAGE_SETUP_FAILED' }],
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('private-host')
  })
})

function fakePool() {
  const query = vi.fn()
  const connect = vi.fn()
  const end = vi.fn()
  return { query, connect, end } as unknown as Pool & {
    query: typeof query
    connect: typeof connect
    end: typeof end
  }
}
