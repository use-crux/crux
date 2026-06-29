/**
 * Vitest conformance tests for `CruxStore` adapters.
 *
 * Adapter packages can import this helper to run the same public store contract
 * checks against local fakes, without depending on private core test files.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import type { CruxStore, StoreEntry } from '../types'

/** Store capabilities that should be exercised by the conformance suite. */
export interface CruxStoreConformanceSupport {
  /** Whether the target store should honor `set(..., { ttl })`. */
  readonly ttl?: boolean
  /** Whether the target store should hydrate and filter dense vector hits. */
  readonly vectorSearch?: boolean
}

/** Options for {@link describeCruxStoreConformance}. */
export interface DescribeCruxStoreConformanceOptions {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /**
   * Create a fresh store for one conformance test.
   *
   * The helper calls `prepare()` per test so adapters can keep each scenario
   * isolated and deterministic.
   */
  readonly prepare: () => CruxStore | Promise<CruxStore>
  /** Capabilities to test in addition to required CRUD and list behavior. */
  readonly supports?: CruxStoreConformanceSupport
}

/**
 * Register the shared `CruxStore` conformance suite.
 *
 * The suite verifies public behavior only: CRUD, JSON isolation, list
 * pagination/filter semantics, TTL expiry when supported, and hydrated dense
 * vector search when supported.
 */
export function describeCruxStoreConformance(options: DescribeCruxStoreConformanceOptions): void {
  describe(`${options.name} CruxStore conformance`, () => {
    it('round-trips, overwrites, deletes, and isolates JSON values', async () => {
      const store = await options.prepare()
      const original = { title: 'hello', count: 42, nested: { a: 1 } }

      await expect(store.get('missing')).resolves.toBeNull()
      await store.set('crud:item', original)
      original.title = 'mutated'

      const firstRead = await store.get('crud:item')
      expect(firstRead).toEqual({ title: 'hello', count: 42, nested: { a: 1 } })

      if (firstRead) {
        firstRead.title = 'changed'
      }
      await expect(store.get('crud:item')).resolves.toEqual({ title: 'hello', count: 42, nested: { a: 1 } })

      await store.set('crud:item', { version: 2 })
      await expect(store.get('crud:item')).resolves.toEqual({ version: 2 })

      await store.delete('crud:item')
      await expect(store.get('crud:item')).resolves.toBeNull()
      await expect(store.delete('missing')).resolves.toBeUndefined()
    })

    it('lists by prefix with pagination and decoded top-level filters', async () => {
      const store = await options.prepare()
      await seedListEntries(store)

      const firstPage = await store.list('memory:', { limit: 2 })
      expect(firstPage.entries).toHaveLength(2)
      expect(firstPage.cursor).toBeDefined()

      const secondPage = await store.list('memory:', { limit: 2, cursor: firstPage.cursor })
      expectKeys([...firstPage.entries, ...secondPage.entries], ['memory:a', 'memory:b', 'memory:c'])

      const notes = await store.list('memory:', { limit: 2, filter: { kind: 'note' } })
      expectKeys(notes.entries, ['memory:a', 'memory:c'])

      const nullish = await store.list('memory:', { filter: { removedAt: null } })
      expectKeys(nullish.entries, ['memory:a', 'memory:b', 'memory:c'])

      const missing = await store.list('does-not-exist:')
      expect(missing).toEqual({ entries: [] })
    })

    if (options.supports?.ttl) {
      it('excludes expired values from get, list, and vector search', async () => {
        vi.useFakeTimers()
        try {
          vi.setSystemTime(new Date('2026-06-29T00:00:00.000Z'))
          const store = await options.prepare()

          await store.set('ttl:expired', { content: 'old', embedding: [1, 0] }, { ttl: 1_000 })
          await store.set('ttl:fresh', { content: 'fresh', embedding: [1, 0] })

          await expect(store.get('ttl:expired')).resolves.toMatchObject({ content: 'old', embedding: [1, 0] })
          vi.advanceTimersByTime(1_001)

          await expect(store.get('ttl:expired')).resolves.toBeNull()
          expectKeys((await store.list('ttl:')).entries, ['ttl:fresh'])

          if (options.supports?.vectorSearch && store.searchVectors) {
            const results = await store.searchVectors({ dense: [1, 0], limit: 10 })
            expectKeys(results, ['ttl:fresh'])
          }
        } finally {
          vi.useRealTimers()
        }
      })
    }

    if (options.supports?.vectorSearch) {
      it('hydrates dense vector hits and applies decoded filters', async () => {
        const store = await options.prepare()
        expect(store.searchVectors).toBeTypeOf('function')

        await store.set('vector:match', {
          content: 'Match',
          namespace: 'customer-1',
          blockId: 'facts',
          embedding: [1, 0],
        })
        await store.set('vector:wrong-block', {
          content: 'Wrong block',
          namespace: 'customer-1',
          blockId: 'episodes',
          embedding: [1, 0],
        })
        await store.set('vector:wrong-namespace', {
          content: 'Wrong namespace',
          namespace: 'customer-2',
          blockId: 'facts',
          embedding: [1, 0],
        })

        const results = await store.searchVectors!({
          dense: [1, 0],
          limit: 10,
          threshold: 0.8,
          filter: { namespace: 'customer-1', blockId: 'facts' },
        })

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          key: 'vector:match',
          value: { content: 'Match', namespace: 'customer-1', blockId: 'facts' },
        })
        expect(results[0]?.score).toBeGreaterThanOrEqual(0.8)
      })
    }
  })
}

async function seedListEntries(store: CruxStore): Promise<void> {
  await store.set('memory:a', { kind: 'note', text: 'Alpha', updatedAt: 100 })
  await store.set('memory:b', { kind: 'task', text: 'Skip me', updatedAt: 200, removedAt: null })
  await store.set('memory:c', { kind: 'note', text: 'Beta', updatedAt: 300 })
  await store.set('other:a', { kind: 'note', text: 'Outside prefix', updatedAt: 400 })
}

function expectKeys(entries: readonly StoreEntry[], expectedKeys: readonly string[]): void {
  expect(new Set(entries.map((entry) => entry.key))).toEqual(new Set(expectedKeys))
}
