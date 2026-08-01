/**
 * Connected knowledge storage conformance suite.
 *
 * Storage adapter packages use this runner to verify the storage-observable
 * connected knowledge contract through the public {@link Storage} bundle.
 *
 * @example
 * ```ts
 * import { expect, test } from 'vitest'
 * import { runConnectedKnowledgeConformance } from '@use-crux/core/knowledge'
 * import { createAdapterStorage } from '../src/storage'
 *
 * runConnectedKnowledgeConformance({
 *   createStorage: createAdapterStorage,
 *   test,
 *   expect,
 * })
 * ```
 *
 * @module
 */

import { createIndexedKnowledgeStore } from '../indexed-knowledge'
import { indexedSourcePrefix } from '../indexed-knowledge/keys'
import type { Storage } from '../storage'
import { createCommunityStore } from './communities/store'
import { deleteKnowledgeClaimsForSource } from './compile'
import { createKnowledgeGenerationStore } from './generation'
import { createKnowledgeGraphStore } from './graph-store'
import {
  knowledgeAdjacencyInKey,
  knowledgeAdjacencyInPrefix,
  knowledgeAdjacencyOutKey,
  knowledgeAdjacencyOutPrefix,
  knowledgeAliasKey,
  knowledgeClaimsKey,
  knowledgeGenerationPrefix,
  knowledgeViewRevisionKey,
} from './keys'
import { decodeKnowledgeRef, encodeKnowledgeRef } from './refs'
import { applyMembershipForSource, resolveViewMembers } from './view/membership'
import { loadViewRevision, resolveViewRevision } from './view/revision'
import {
  chunk,
  chunkRef,
  communityScopeKey,
  countRecordAccess,
  documentRef,
  edge,
  entity,
  entityJson,
  entityRef,
  expectRejects,
  indexerId,
  lineage,
  namespace,
  parentRef,
  publishEdges,
  publishEntity,
  publishReport,
  report,
  viewId,
  where,
} from './conformance-fixtures'

/** Test registration hook accepted by {@link runConnectedKnowledgeConformance}. */
export type ConnectedKnowledgeConformanceTest = (
  name: string,
  fn: () => void | Promise<void>,
) => void

/** Minimal assertion hook accepted by {@link runConnectedKnowledgeConformance}. */
export interface ConnectedKnowledgeConformanceExpect {
  (actual: unknown): ConnectedKnowledgeConformanceAssertion
}

/** Matcher subset used by the connected knowledge conformance suite. */
export interface ConnectedKnowledgeConformanceAssertion {
  readonly not: Pick<ConnectedKnowledgeConformanceAssertion, 'toBe'>
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toMatchObject(expected: object): void
}

/** Options for {@link runConnectedKnowledgeConformance}. */
export interface RunConnectedKnowledgeConformanceOptions {
  /** Create a fresh, isolated storage bundle for each conformance case. */
  readonly createStorage: () => Storage | Promise<Storage>
  /** Register one named test case with the caller's runner. */
  readonly test: ConnectedKnowledgeConformanceTest
  /** Assertion hook from the caller's runner. */
  readonly expect: ConnectedKnowledgeConformanceExpect
}

/** Register shared connected knowledge storage behavior checks. */
export function runConnectedKnowledgeConformance(options: RunConnectedKnowledgeConformanceOptions): void {
  options.test('round-trips knowledge refs and scans knowledge key prefixes', async () => {
    const { records } = await options.createStorage()
    const refs = [
      documentRef('doc:1%'),
      parentRef('doc:1%', 'parent:1%'),
      chunkRef('doc:1%', 'chunk:1%'),
      entityRef('Entity:1%'),
    ]

    for (const ref of refs) {
      options.expect(decodeKnowledgeRef(encodeKnowledgeRef(ref))).toEqual(ref)
    }

    await records.put(entity.key('gen-1', 'crux'), entityJson('gen-1', 'crux'))
    await records.put(knowledgeAliasKey(indexerId, namespace, 'gen-1', 'Crux', 'crux'), { entityId: 'crux' })
    await records.put(entity.key('gen-1', 'hidden', 'other'), entityJson('gen-1', 'hidden', 'other'))

    const page = await records.list(knowledgeGenerationPrefix(indexerId, namespace, 'gen-1'))
    options.expect(page.entries.map((entry) => entry.key).sort()).toEqual([
      knowledgeAliasKey(indexerId, namespace, 'gen-1', 'Crux', 'crux'),
      entity.key('gen-1', 'crux'),
    ])
  })

  options.test('keeps generation publication atomic across publish, abandon, and crash-before-publish', async () => {
    const { records } = await options.createStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })

    await publishEntity(generations, 'gen-1', 'stable')
    const partial = generations.beginGeneration('gen-2')
    await partial.putEntity(entity.record('gen-2', 'partial'))
    await partial.finish()

    options.expect(await generations.currentGeneration()).toBe('gen-1')
    options.expect(await records.get(entity.key('gen-2', 'partial'))).toMatchObject({
      entityId: 'partial',
    })

    await generations.abandon('gen-2')
    options.expect(await records.get(entity.key('gen-2', 'partial'))).toBe(null)
    await expectRejects(() => generations.publish('gen-2'), /abandoned/, options.expect)

    await publishEntity(generations, 'gen-3', 'fresh')
    options.expect(await generations.currentGeneration()).toBe('gen-3')
    options.expect((await records.list(knowledgeGenerationPrefix(indexerId, namespace, 'gen-1'))).entries).toEqual([])
  })

  options.test('reads adjacency through outbound and inbound scans', async () => {
    const { records } = await options.createStorage()
    const from = documentRef('guide')
    const to = entityRef('crux')
    const edgeRecord = edge('gen-1', 'mentions', from, to)

    await publishEdges(records, 'gen-1', [edgeRecord])

    const outPage = await records.list(knowledgeAdjacencyOutPrefix(indexerId, namespace, 'gen-1', from))
    options.expect(outPage.entries.map((entry) => entry.key)).toEqual([
      knowledgeAdjacencyOutKey(indexerId, namespace, 'gen-1', from, 'mentions', edgeRecord.edgeId),
    ])
    const inPage = await records.list(knowledgeAdjacencyInPrefix(indexerId, namespace, 'gen-1', to))
    options.expect(inPage.entries.map((entry) => entry.key)).toEqual([
      knowledgeAdjacencyInKey(indexerId, namespace, 'gen-1', to, 'mentions', edgeRecord.edgeId),
    ])

    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })
    options.expect(await graph.neighbors(from, { direction: 'out' })).toEqual([
      { ref: to, type: 'mentions', direction: 'out' },
    ])
    options.expect(await graph.neighbors(to, { direction: 'in' })).toEqual([
      { ref: from, type: 'mentions', direction: 'in' },
    ])
  })

  options.test('maintains view membership indexes and resolves members from indexes only', async () => {
    const { records } = await options.createStorage()
    const counted = countRecordAccess(records)

    await applyMembershipForSource({ records: counted.store, indexerId, namespace, viewId, where, sourceId: 's1', metadata: { status: 'open', team: 'core' } })
    await applyMembershipForSource({ records: counted.store, indexerId, namespace, viewId, where, sourceId: 's2', metadata: { status: 'closed', team: 'docs' } })
    await applyMembershipForSource({ records: counted.store, indexerId, namespace, viewId, where, sourceId: 's1', metadata: { status: 'closed', team: 'core' } })

    counted.getKeys.length = 0
    counted.listPrefixes.length = 0
    options.expect(await resolveViewMembers({ records: counted.store, indexerId, namespace, viewId, where })).toEqual(['s2'])
    options.expect(counted.getKeys).toEqual([])
    options.expect(counted.listPrefixes.every((prefix) => prefix.includes(':view:active:index:'))).toBe(true)
  })

  options.test('creates view revisions idempotently by content address', async () => {
    const { records } = await options.createStorage()
    const first = await resolveViewRevision({ records, indexerId, namespace, viewId, members: [
      { sourceId: 's2', contentHash: 'h2' },
      { sourceId: 's1', contentHash: 'h1' },
    ] })
    const second = await resolveViewRevision({ records, indexerId, namespace, viewId, members: [
      { sourceId: 's1', contentHash: 'h1' },
      { sourceId: 's2', contentHash: 'h2' },
    ] })

    options.expect(second.revisionHash).toBe(first.revisionHash)
    options.expect(await loadViewRevision({ records, indexerId, namespace, viewId, revisionHash: first.revisionHash })).toEqual(first)
    options.expect(await records.get(knowledgeViewRevisionKey(indexerId, namespace, viewId, first.revisionHash))).toMatchObject({
      revisionHash: first.revisionHash,
    })
  })

  options.test('serves community generations atomically and coordinates leases', async () => {
    const { records } = await options.createStorage()
    const store = createCommunityStore({ records, indexerId, namespace, scopeKey: communityScopeKey })

    await publishReport(store, 'gen-1', 'stable')
    const partial = store.beginGeneration('gen-2')
    await partial.putReport(report('gen-2', 'partial'))
    await partial.putLevelIndex({ generationId: 'gen-2', communityId: 'partial', level: 0 })

    options.expect(await store.byId('stable')).toMatchObject({ communityId: 'stable', generationId: 'gen-1' })
    options.expect(await store.byId('partial')).toBe(null)
    options.expect(await store.claimLease('owner-1', { ttlMs: 100, now: 1_000 })).toBe(true)
    options.expect(await store.claimLease('owner-2', { ttlMs: 100, now: 1_050 })).toBe(false)
    options.expect(await store.isLeaseStale(100, 1_101)).toBe(true)
    options.expect(await store.claimLease('owner-2', { ttlMs: 100, now: 1_101 })).toBe(true)
    options.expect(await store.heartbeatLease('owner-1', 1_200)).toBe(false)
    options.expect(await store.heartbeatLease('owner-2', 1_200)).toBe(true)
  })

  options.test('removes source-scoped storage from indexed, claim, and view visibility', async () => {
    const { records } = await options.createStorage()
    const indexed = createIndexedKnowledgeStore({ records, indexerId, namespace })

    await indexed.persistGeneration({ chunks: [chunk('removed', 'main', 'removed', { status: 'open' })], parents: [], replaceSources: true, now: 1 })
    await applyMembershipForSource({ records, indexerId, namespace, viewId, where, sourceId: 'removed', metadata: { status: 'open' } })
    await records.put(knowledgeClaimsKey(indexerId, namespace, 'stage', 'removed', 'claim'), { sourceId: 'removed' })

    options.expect(await resolveViewMembers({ records, indexerId, namespace, viewId, where })).toEqual(['removed'])
    await indexed.deleteSource('removed')
    await deleteKnowledgeClaimsForSource({ records, indexerId, namespace, sourceId: 'removed', stageIds: ['stage'] })
    await applyMembershipForSource({ records, indexerId, namespace, viewId, where, sourceId: 'removed', metadata: null })

    options.expect(await createKnowledgeGraphStore({ records, indexerId, namespace }).hydrate(chunkRef('removed', 'main'))).toBe(null)
    options.expect((await records.list(indexedSourcePrefix(indexerId, namespace, 'removed'))).entries).toEqual([])
    options.expect((await records.list(knowledgeClaimsKey(indexerId, namespace, 'stage', 'removed', ''))).entries).toEqual([])
    options.expect(await resolveViewMembers({ records, indexerId, namespace, viewId, where })).toEqual([])
  })
}
