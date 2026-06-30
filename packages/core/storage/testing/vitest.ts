/**
 * Vitest conformance helpers for Storage Beta adapters.
 *
 * Adapter packages can use these suites to prove their claimed
 * `RecordStore`, `VectorStore`, and `BlobStore` capabilities through the
 * public storage interfaces.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { StorageError } from '../errors'
import type { BlobStore, JsonObject, RecordEntry, RecordStore, VectorStore } from '../types'

/** Options for {@link describeRecordStoreConformance}. */
export interface DescribeRecordStoreConformanceOptions<T extends JsonObject = JsonObject> {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /** Create a fresh, isolated record store for each conformance test. */
  readonly prepare: () => RecordStore<T> | Promise<RecordStore<T>>
}

/** Options for {@link describeVectorStoreConformance}. */
export interface DescribeVectorStoreConformanceOptions {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /** Create a fresh, isolated vector store for each conformance test. */
  readonly prepare: () => VectorStore | Promise<VectorStore>
}

/** Options for {@link describeBlobStoreConformance}. */
export interface DescribeBlobStoreConformanceOptions {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /** Create a fresh, isolated blob store for each conformance test. */
  readonly prepare: () => BlobStore | Promise<BlobStore>
}

/** Register shared behavior checks for beta `RecordStore` adapters. */
export function describeRecordStoreConformance<T extends JsonObject = JsonObject>(
  options: DescribeRecordStoreConformanceOptions<T>,
): void {
  describe(`${options.name} RecordStore conformance`, () => {
    it('round-trips, creates atomically, deletes, and isolates JSON records', async () => {
      const records = await options.prepare()
      const original = { title: 'hello', nested: { count: 1 } } as unknown as T

      await expect(records.get('records:missing')).resolves.toBeNull()
      await records.put('records:item', original)
      ;(original as unknown as { title: string }).title = 'mutated'

      const firstRead = await records.get('records:item')
      expect(firstRead).toEqual({ title: 'hello', nested: { count: 1 } })
      if (firstRead) {
        ;(firstRead as unknown as { nested: { count: number } }).nested.count = 2
      }
      await expect(records.get('records:item')).resolves.toEqual({ title: 'hello', nested: { count: 1 } })

      await expect(records.create('records:item', { title: 'ignored' } as unknown as T)).resolves.toBe(false)
      await expect(records.create('records:new', { title: 'new' } as unknown as T)).resolves.toBe(true)
      await expect(records.get('records:new')).resolves.toEqual({ title: 'new' })

      await records.delete('records:item')
      await expect(records.get('records:item')).resolves.toBeNull()
    })

    it('rejects invalid JSON values and invalid TTL values with storage errors', async () => {
      const records = await options.prepare()

      await expect(records.put('invalid:date', { createdAt: new Date() } as unknown as T)).rejects.toMatchObject({
        code: 'invalid_value',
      })
      await expect(records.put('invalid:ttl', { ok: true } as unknown as T, { ttlMs: 0 })).rejects.toMatchObject({
        code: 'invalid_value',
      })
      await expect(records.put('invalid:ttl', { ok: true } as unknown as T, { ttlMs: 1.5 })).rejects.toMatchObject({
        code: 'invalid_value',
      })
    })

    it('lists, scans, filters, and distinguishes null from missing fields', async () => {
      const records = await options.prepare()
      await records.put('memory:a', { kind: 'note', removedAt: null, updatedAt: 100 } as unknown as T)
      await records.put('memory:b', { kind: 'task', updatedAt: 200 } as unknown as T)
      await records.put('memory:c', { kind: 'note', removedAt: null, updatedAt: 300 } as unknown as T)
      await records.put('other:a', { kind: 'note', removedAt: null, updatedAt: 400 } as unknown as T)

      const firstPage = await records.list('memory:', { limit: 2 })
      expect(firstPage.entries).toHaveLength(2)
      expect(firstPage.cursor).toBeDefined()
      const secondPage = await records.list('memory:', { limit: 2, cursor: firstPage.cursor })
      expectKeys([...firstPage.entries, ...secondPage.entries], ['memory:a', 'memory:b', 'memory:c'])

      expectKeys((await records.list('memory:', { filter: { kind: 'note' } })).entries, ['memory:a', 'memory:c'])
      expectKeys((await records.list('memory:', { filter: { removedAt: null } })).entries, ['memory:a', 'memory:c'])

      if (records.scan) {
        const scanned: RecordEntry<T>[] = []
        for await (const entry of records.scan('memory:', { limit: 1 })) {
          scanned.push(entry)
        }
        expectKeys(scanned, ['memory:a', 'memory:b', 'memory:c'])
      }
    })

    it('suppresses lazy-TTL records from get, list, and scan', async () => {
      const records = await options.prepare()
      if (records.capabilities().ttl === false) {
        await expect(records.put('ttl:nope', { ok: true } as unknown as T, { ttlMs: 100 })).rejects.toBeInstanceOf(
          StorageError,
        )
        return
      }

      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
        await records.put('ttl:expired', { status: 'old' } as unknown as T, { ttlMs: 1_000 })
        await records.put('ttl:fresh', { status: 'fresh' } as unknown as T)
        vi.advanceTimersByTime(1_001)

        await expect(records.get('ttl:expired')).resolves.toBeNull()
        expectKeys((await records.list('ttl:')).entries, ['ttl:fresh'])
        if (records.scan) {
          const scanned: RecordEntry<T>[] = []
          for await (const entry of records.scan('ttl:')) {
            scanned.push(entry)
          }
          expectKeys(scanned, ['ttl:fresh'])
        }
      } finally {
        vi.useRealTimers()
      }
    })
  })
}

/** Register shared behavior checks for beta `VectorStore` adapters. */
export function describeVectorStoreConformance(options: DescribeVectorStoreConformanceOptions): void {
  describe(`${options.name} VectorStore conformance`, () => {
    it('validates vector input and exact metadata filters with storage errors', async () => {
      const vectors = await options.prepare()

      await expect(vectors.upsert([{ key: 'bad:dense', dense: [1, Number.NaN] }])).rejects.toMatchObject({
        code: 'invalid_value',
      })
      await expect(
        vectors.upsert([{ key: 'bad:sparse', sparse: { indices: [0, 0], values: [1, 2] } }]),
      ).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(vectors.search({ mode: 'dense', dense: [] })).rejects.toMatchObject({ code: 'invalid_value' })
      await expect(vectors.search({ mode: 'dense', dense: [1], filter: { nested: {} } as never })).rejects.toMatchObject({
        code: 'invalid_filter',
      })
    })

    it('searches dense vectors with threshold, limit, delete, and exact pre-filters', async () => {
      const vectors = await options.prepare()
      await vectors.upsert([
        { key: 'vector:match', dense: [1, 0], metadata: { namespace: 'a', block: 'facts' } },
        { key: 'vector:missing-metadata', dense: [1, 0] },
        { key: 'vector:wrong-filter', dense: [1, 0], metadata: { namespace: 'b', block: 'facts' } },
        { key: 'vector:below-threshold', dense: [0, 1], metadata: { namespace: 'a', block: 'facts' } },
      ])

      await expect(
        vectors.search({
          mode: 'dense',
          dense: [1, 0],
          limit: 1,
          threshold: 0.8,
          filter: { namespace: 'a', block: 'facts' },
        }),
      ).resolves.toEqual([expect.objectContaining({ key: 'vector:match', metadata: { namespace: 'a', block: 'facts' } })])

      await vectors.delete(['vector:match'])
      await expect(
        vectors.search({ mode: 'dense', dense: [1, 0], threshold: 0.8, filter: { namespace: 'a' } }),
      ).resolves.toEqual([])
    })

    it('honors sparse, hybrid, and fusion capability claims', async () => {
      const vectors = await options.prepare()
      const capabilities = vectors.capabilities()

      if (capabilities.sparse) {
        await vectors.upsert([
          {
            key: 'vector:sparse',
            sparse: { indices: [3], values: [2] },
            metadata: { namespace: 'sparse' },
          },
        ])
        await expect(vectors.search({ mode: 'sparse', sparse: { indices: [3], values: [1] } })).resolves.toEqual([
          expect.objectContaining({ key: 'vector:sparse' }),
        ])
      } else {
        await expect(vectors.search({ mode: 'sparse', sparse: { indices: [3], values: [1] } })).rejects.toMatchObject({
          code: 'unsupported_capability',
        })
      }

      if (capabilities.hybrid) {
        await vectors.upsert([
          {
            key: 'vector:hybrid',
            dense: [1, 0],
            sparse: { indices: [3], values: [2] },
            metadata: { namespace: 'hybrid' },
          },
        ])
        await expect(
          vectors.search({
            mode: 'hybrid',
            dense: [1, 0],
            sparse: { indices: [3], values: [1] },
            filter: { namespace: 'hybrid' },
          }),
        ).resolves.toEqual([expect.objectContaining({ key: 'vector:hybrid' })])
      } else {
        await expect(
          vectors.search({ mode: 'hybrid', dense: [1, 0], sparse: { indices: [3], values: [1] } }),
        ).rejects.toMatchObject({ code: 'unsupported_capability' })
      }

      const unsupportedFusion = (['rrf', 'dbsf'] as const).find((fusion) => !capabilities.fusion.includes(fusion))
      if (unsupportedFusion) {
        await expect(
          vectors.search({
            mode: 'hybrid',
            dense: [1, 0],
            sparse: { indices: [3], values: [1] },
            fusion: unsupportedFusion,
          }),
        ).rejects.toMatchObject({ code: 'unsupported_capability' })
      }
    })
  })
}

/** Register shared behavior checks for beta `BlobStore` adapters. */
export function describeBlobStoreConformance(options: DescribeBlobStoreConformanceOptions): void {
  describe(`${options.name} BlobStore conformance`, () => {
    it('puts, reads, heads, deletes, and preserves content metadata', async () => {
      const blobs = await options.prepare()
      const ref = await blobs.put({ key: 'reports/a.txt', content: 'hello', mimeType: 'text/plain' })

      expect(ref.size).toBe(5)
      const read = await blobs.get(ref.uri)
      expect(read).toMatchObject({ mimeType: 'text/plain', size: 5 })
      if (typeof read.content === 'string') {
        expect(read.content).toBe('hello')
      } else if (typeof Blob !== 'undefined' && read.content instanceof Blob) {
        await expect(read.content.text()).resolves.toBe('hello')
      } else {
        expect(read.content).toEqual(new TextEncoder().encode('hello'))
      }
      await expect(blobs.head?.(ref.uri)).resolves.toMatchObject({ uri: ref.uri, size: 5 })
      await blobs.delete(ref.uri)
      await expect(blobs.head?.(ref.uri)).resolves.toBeNull()
      await expect(blobs.get(ref.uri)).rejects.toMatchObject({ code: 'not_found' })
    })
  })
}

function expectKeys(entries: readonly { readonly key: string }[], expectedKeys: readonly string[]): void {
  expect(new Set(entries.map((entry) => entry.key))).toEqual(new Set(expectedKeys))
}
