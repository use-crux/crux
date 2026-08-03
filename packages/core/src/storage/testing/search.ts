/**
 * Reusable conformance suite for storage adapters.
 *
 * The suite verifies search behavior through the public `SearchStore` contract
 * and indexed-knowledge hydration for adapters that provide records as well.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import type { RecordStore, SearchStore } from '../types'
import { createIndexedKnowledgeStore } from '../../indexed-knowledge'

export interface SearchStoreConformanceHarness {
  readonly records: RecordStore
  readonly search: SearchStore
}

export interface SearchStoreConformanceSuiteOptions {
  readonly name: string
  readonly create: () => Promise<SearchStoreConformanceHarness> | SearchStoreConformanceHarness
}

export function searchStoreConformanceSuite(options: SearchStoreConformanceSuiteOptions): void {
  describe(`${options.name} SearchStore conformance`, () => {
    it('searches dense and sparse legs with exact pre-filters', async () => {
      const { search } = await options.create()
      await search.upsert([
        { key: 'tenant-a:alpha', dense: [1, 0], sparse: { indices: [4], values: [1] }, metadata: { namespace: 'tenant-a' } },
        { key: 'tenant-b:alpha', dense: [1, 0], sparse: { indices: [4], values: [1] }, metadata: { namespace: 'tenant-b' } },
      ])
      await expect(search.search({
        legs: [{ kind: 'dense', vector: [1, 0] }],
        filter: { namespace: 'tenant-a' },
      })).resolves.toEqual([expect.objectContaining({ key: 'tenant-a:alpha' })])
      await expect(search.search({
        legs: [{ kind: 'sparse', vector: { indices: [4], values: [1] } }],
        filter: { namespace: 'tenant-b' },
      })).resolves.toEqual([expect.objectContaining({ key: 'tenant-b:alpha' })])
    })

    it('hydrates indexed-knowledge search hits strictly', async () => {
      const { records, search } = await options.create()
      const knowledge = createIndexedKnowledgeStore({
        indexerId: 'docs',
        namespace: 'kb',
        records,
        search,
      })
      await search.upsert([
        {
          key: 'indexer:docs:namespace:kb:source:missing:chunk:c1',
          dense: [1, 0],
          metadata: { _cruxRecordType: 'chunk', namespace: 'kb', active: true },
        },
      ])
      await expect(knowledge.searchChunks({
        legs: { dense: { vector: [1, 0] } },
        threshold: 0.8,
      })).rejects.toMatchObject({
        code: 'hydration_miss',
      })
    })
  })
}
