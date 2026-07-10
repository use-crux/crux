/**
 * Vitest vector-store conformance suite for Retrieval & RAG adapters.
 *
 * The suite verifies vector behavior through the public `VectorStore` contract
 * and the indexed-knowledge read model that hydrates vector hits into
 * retrieval hits.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../indexed-knowledge'
import { indexedChunkKey } from '../../indexed-knowledge/keys'
import type { RecordStore, VectorStore } from '../types'

/** Fresh stores used by one vector conformance test case. */
export interface VectorStoreConformanceHarness {
  /** Vector store under test. */
  readonly vectors: VectorStore
  /** Record store used for indexed-knowledge hydration tests. */
  readonly records: RecordStore
  /** Release adapter resources created for this test case. */
  cleanup(): Promise<void>
}

/** Capability claims that the suite verifies with required or skipped cases. */
export interface VectorStoreConformanceCapabilities {
  /** Whether sparse vector upsert/search is supported. */
  readonly sparse: boolean
  /** Whether hybrid dense+sparse upsert/search is supported. */
  readonly hybrid: boolean
  /** Whether vector deletion is supported. */
  readonly delete: boolean
}

/** Options for {@link vectorStoreConformanceSuite}. */
export interface VectorStoreConformanceSuiteOptions {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /** Create fresh, isolated stores for each conformance case. */
  readonly create: () => Promise<VectorStoreConformanceHarness> | VectorStoreConformanceHarness
  /** Capabilities the adapter claims for vector behavior. */
  readonly capabilities: VectorStoreConformanceCapabilities
}

/** Register the Retrieval & RAG beta vector-store conformance suite. */
export function vectorStoreConformanceSuite(options: VectorStoreConformanceSuiteOptions): void {
  describe(`${options.name} VectorStore conformance`, () => {
    it('searches dense vectors with ordering, threshold, filters, and namespace isolation', async () => {
      await withHarness(options, async ({ vectors }) => {
        await vectors.upsert([
          { key: 'tenant-a:alpha', dense: [1, 0], metadata: { namespace: 'tenant-a', topic: 'pricing' } },
          { key: 'tenant-a:beta', dense: [0.9, 0.1], metadata: { namespace: 'tenant-a', topic: 'pricing' } },
          { key: 'tenant-b:alpha', dense: [1, 0], metadata: { namespace: 'tenant-b', topic: 'pricing' } },
          { key: 'tenant-a:low', dense: [0, 1], metadata: { namespace: 'tenant-a', topic: 'pricing' } },
        ])

        await expect(
          vectors.search({
            mode: 'dense',
            dense: [1, 0],
            limit: 2,
            threshold: 0.5,
            filter: { namespace: 'tenant-a', topic: 'pricing' },
          }),
        ).resolves.toEqual([
          expect.objectContaining({ key: 'tenant-a:alpha' }),
          expect.objectContaining({ key: 'tenant-a:beta' }),
        ])
      })
    })

    it('deletes vectors or fails with an explicit unsupported capability error', async () => {
      await withHarness(options, async ({ vectors }) => {
        await vectors.upsert([{ key: 'delete:alpha', dense: [1, 0], metadata: { namespace: 'delete' } }])

        if (options.capabilities.delete) {
          await vectors.delete(['delete:alpha'])
          await expect(vectors.search({ mode: 'dense', dense: [1, 0], filter: { namespace: 'delete' } })).resolves.toEqual([])
        } else {
          await expect(vectors.delete(['delete:alpha'])).rejects.toMatchObject({ code: 'unsupported_capability' })
        }
      })
    })

    it('honors sparse and hybrid capability claims before mutation', async () => {
      await withHarness(options, async ({ vectors }) => {
        if (options.capabilities.sparse) {
          await vectors.upsert([
            { key: 'sparse:alpha', sparse: { indices: [4], values: [2] }, metadata: { namespace: 'sparse' } },
          ])
          await expect(vectors.search({ mode: 'sparse', sparse: { indices: [4], values: [1] } })).resolves.toEqual([
            expect.objectContaining({ key: 'sparse:alpha' }),
          ])
        } else {
          await expect(
            vectors.upsert([{ key: 'sparse:alpha', sparse: { indices: [4], values: [2] } }]),
          ).rejects.toMatchObject({ code: 'unsupported_capability' })
        }

        if (options.capabilities.hybrid) {
          await vectors.upsert([
            {
              key: 'hybrid:alpha',
              dense: [1, 0],
              sparse: { indices: [4], values: [2] },
              metadata: { namespace: 'hybrid' },
            },
          ])
          await expect(
            vectors.search({
              mode: 'hybrid',
              dense: [1, 0],
              sparse: { indices: [4], values: [1] },
              filter: { namespace: 'hybrid' },
            }),
          ).resolves.toEqual([expect.objectContaining({ key: 'hybrid:alpha' })])
        } else {
          await expect(
            vectors.upsert([{ key: 'hybrid:alpha', dense: [1, 0], sparse: { indices: [4], values: [2] } }]),
          ).rejects.toMatchObject({ code: 'unsupported_capability' })
        }
      })
    })

    it('fails with a hydration diagnostic when vector hits have no backing records', async () => {
      await withHarness(options, async ({ records, vectors }) => {
        const knowledge = createIndexedKnowledgeStore({
          indexerId: 'docs',
          namespace: 'tenant-a',
          records,
          vectors,
        })

        await knowledge.persistGeneration({
          chunks: [
            {
              namespace: 'tenant-a',
              sourceId: 'orphan',
              chunkId: 'a',
              ordinal: 0,
              content: 'orphaned vector',
              metadata: { topic: 'diagnostics' },
            },
          ],
          parents: [],
          dense: [[1, 0]],
          replaceSources: true,
        })
        const key = indexedChunkKey('docs', 'tenant-a', 'orphan', 'a')
        await records.delete(key)
        await vectors.upsert([
          {
            key,
            dense: [1, 0],
            metadata: {
              namespace: 'tenant-a',
              _cruxRecordType: 'chunk',
              active: true,
              sourceId: 'orphan',
              chunkId: 'a',
              topic: 'diagnostics',
            },
          },
        ])

        await expect(knowledge.searchChunks({ mode: 'dense', dense: [1, 0], threshold: 0.8 })).rejects.toMatchObject({
          name: 'RetrievalRunError',
          code: 'hydration_miss',
        })
      })
    })
  })
}

async function withHarness(
  options: VectorStoreConformanceSuiteOptions,
  run: (harness: VectorStoreConformanceHarness) => Promise<void>,
): Promise<void> {
  const harness = await options.create()
  try {
    await run(harness)
  } finally {
    await harness.cleanup()
  }
}
