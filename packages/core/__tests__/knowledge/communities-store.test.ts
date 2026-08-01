import { describe, expect, it } from 'vitest'
import {
  communityCurrentKey,
  communityDirtyKey,
  communityGenerationPrefix,
  communityLeaseKey,
  communityLevelIndexKey,
  communityReportKey,
  communityScopeKey,
} from '../../src/knowledge/communities/keys'
import { createCommunityReportRecord, type CommunityReport } from '../../src/knowledge/communities/records'
import {
  createCommunityStore,
  type CommunityGenerationRetention,
  type CommunityStore,
} from '../../src/knowledge/communities/store'
import { inMemoryStorage } from '../../src/storage'

const indexerId = 'docs'
const namespace = 'kb'
const scopeKey = 'scope_1'
const lineage = {
  viewRevision: 'view-rev-1',
  graphGeneration: 'graph-gen-1',
  strategyFingerprint: 'strategy-1',
  memberHash: 'members-1',
}

describe('community storage keys', () => {
  it('builds exact persisted key strings for a scoped community generation', () => {
    expect(communityScopeKey({ viewId: 'view:1', strategyFingerprint: 'strategy:1' })).toBe('60fc0cf9')
    expect(communityScopeKey({ strategyFingerprint: 'strategy:1' })).toBe('594aa1d7')
    expect(communityCurrentKey('kb', 'tenant:a', 'scope:1')).toBe(
      'indexer:kb:namespace:tenant:a:communities:scope:1:current',
    )
    expect(communityReportKey('kb', 'tenant:a', 'scope:1', 'gen:1', 'community:1')).toBe(
      'indexer:kb:namespace:tenant:a:communities:scope:1:gen:gen:1:report:community:1',
    )
    expect(communityLevelIndexKey('kb', 'tenant:a', 'scope:1', 'gen:1', 2, 'community:1')).toBe(
      'indexer:kb:namespace:tenant:a:communities:scope:1:gen:gen:1:index:2:community:1',
    )
    expect(communityDirtyKey('kb', 'tenant:a', 'scope:1', 'source:1')).toBe(
      'indexer:kb:namespace:tenant:a:communities:scope:1:dirty:source:1',
    )
    expect(communityLeaseKey('kb', 'tenant:a', 'scope:1')).toBe(
      'indexer:kb:namespace:tenant:a:communities:scope:1:lease',
    )
  })
})

describe('community report record codec', () => {
  it('rejects oversized title, summary, and finding statements on create', () => {
    expect(() => createCommunityReportRecord(report('gen-1', 'c1', { title: 't'.repeat(121) }))).toThrow('title')
    expect(() => createCommunityReportRecord(report('gen-1', 'c1', { summary: 's'.repeat(2_001) }))).toThrow('summary')
    expect(() => createCommunityReportRecord(report('gen-1', 'c1', { statement: 'f'.repeat(501) }))).toThrow('statement')
  })
})

describe('community store', () => {
  it('keeps the prior generation served when a later build crashes before publish', async () => {
    const { store } = setup()

    await publishReport(store, 'gen-1', 'stable')
    const partial = store.beginGeneration('gen-2')
    await partial.putReport(report('gen-2', 'partial'))
    await partial.putLevelIndex({ generationId: 'gen-2', communityId: 'partial', level: 0 })

    await expect(store.byId('stable')).resolves.toMatchObject({ communityId: 'stable', generationId: 'gen-1' })
    await expect(store.byId('partial')).resolves.toBeNull()
    await expect(store.byLevel(0)).resolves.toMatchObject({
      reports: [expect.objectContaining({ communityId: 'stable' })],
    })
  })

  it('converges repeated and concurrent dirty writes to one source-keyed record', async () => {
    const { store, records } = setup()

    await Promise.all([
      store.markDirty('source:1', 'indexed', 10),
      store.markDirty('source:1', 'indexed', 11),
      store.markDirty('source:1', 'removed', 12),
    ])

    const dirty = await store.readDirty()
    expect(dirty).toHaveLength(1)
    expect(dirty[0]).toMatchObject({ sourceId: 'source:1', touchedAt: 12 })

    const page = await records.list('indexer:docs:namespace:kb:communities:scope_1:dirty:')
    expect(page.entries).toHaveLength(1)

    await store.markDirty('source:2', 'indexed', 20)
    await store.clearDirty(12)
    await expect(store.readDirty()).resolves.toEqual([{ sourceId: 'source:2', reason: 'indexed', touchedAt: 20 }])
  })

  it('claims leases with create semantics and permits stale takeover after ttl', async () => {
    const { store } = setup()

    await expect(store.claimLease('owner-1', { ttlMs: 100, now: 1_000 })).resolves.toBe(true)
    await expect(store.claimLease('owner-2', { ttlMs: 100, now: 1_050 })).resolves.toBe(false)
    await expect(store.isLeaseStale(100, 1_050)).resolves.toBe(false)
    await expect(store.isLeaseStale(100, 1_101)).resolves.toBe(true)
    await expect(store.claimLease('owner-2', { ttlMs: 100, now: 1_101 })).resolves.toBe(true)
    await expect(store.heartbeatLease('owner-1', 1_200)).resolves.toBe(false)
    await expect(store.heartbeatLease('owner-2', 1_200)).resolves.toBe(true)
    await expect(store.releaseLease('owner-1')).resolves.toBe(false)
    await expect(store.releaseLease('owner-2')).resolves.toBe(true)
  })

  it('cleans up replaced generations by default and can retain inactive generations', async () => {
    const cleaned = setup()
    await publishReport(cleaned.store, 'gen-1', 'old')
    await publishReport(cleaned.store, 'gen-2', 'new')

    await expect(cleaned.store.byId('new')).resolves.toMatchObject({ communityId: 'new' })
    await expect(cleaned.records.list(communityGenerationPrefix(indexerId, namespace, scopeKey, 'gen-1'))).resolves.toMatchObject({
      entries: [],
    })

    const retained = setup('retain-inactive')
    await publishReport(retained.store, 'gen-1', 'old')
    await publishReport(retained.store, 'gen-2', 'new')

    const oldKey = communityReportKey(indexerId, namespace, scopeKey, 'gen-1', 'old')
    await expect(retained.records.get(oldKey)).resolves.toMatchObject({ communityId: 'old' })
  })

  it('reads current reports by id, level page, and parent community', async () => {
    const { store } = setup()
    const writer = store.beginGeneration('gen-1')
    await writer.putReport(report('gen-1', 'parent', { level: 1 }))
    await writer.putLevelIndex({ generationId: 'gen-1', communityId: 'parent', level: 1 })
    await writer.putReport(report('gen-1', 'child-a', { parentCommunityId: 'parent' }))
    await writer.putLevelIndex({ generationId: 'gen-1', communityId: 'child-a', level: 0, parentCommunityId: 'parent' })
    await writer.putReport(report('gen-1', 'child-b', { parentCommunityId: 'parent' }))
    await writer.putLevelIndex({ generationId: 'gen-1', communityId: 'child-b', level: 0, parentCommunityId: 'parent' })
    await writer.finish()
    await store.publish('gen-1', lineage)

    await expect(store.byId('parent')).resolves.toMatchObject({ communityId: 'parent' })
    await expect(store.byLevel(0, { limit: 1 })).resolves.toMatchObject({
      reports: [expect.objectContaining({ communityId: 'child-a' })],
      cursor: expect.any(String),
    })
    await expect(store.childrenOf('parent')).resolves.toEqual([
      expect.objectContaining({ communityId: 'child-a' }),
      expect.objectContaining({ communityId: 'child-b' }),
    ])
  })
})

function setup(retention?: CommunityGenerationRetention) {
  const { records } = inMemoryStorage()
  return {
    records,
    store: createCommunityStore({ records, indexerId, namespace, scopeKey, retention }),
  }
}

async function publishReport(store: CommunityStore, generationId: string, communityId: string): Promise<void> {
  const writer = store.beginGeneration(generationId)
  await writer.putReport(report(generationId, communityId))
  await writer.putLevelIndex({ generationId, communityId, level: 0 })
  await writer.finish()
  await store.publish(generationId, lineage)
}

function report(
  generationId: string,
  communityId: string,
  overrides: Partial<CommunityReport & { readonly statement: string }> = {},
): CommunityReport {
  return createCommunityReportRecord({
    communityId,
    generationId,
    level: overrides.level ?? 0,
    ...(overrides.parentCommunityId !== undefined ? { parentCommunityId: overrides.parentCommunityId } : {}),
    title: overrides.title ?? `Title ${communityId}`,
    summary: overrides.summary ?? `Summary ${communityId}`,
    findings: [{
      id: 'finding-1',
      statement: overrides.statement ?? 'Finding statement',
      evidence: [{ kind: 'chunk', sourceId: 'source:1', chunkId: 'chunk:1' }],
      assertionRefs: [{ assertionId: 'assertion:1' }],
    }],
    lineage,
    counts: { entities: 1, chunks: 1, assertions: 1 },
  })
}
