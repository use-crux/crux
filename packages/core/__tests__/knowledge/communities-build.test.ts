import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { knowledgeCurrentKey } from '../../src/knowledge/keys'
import { communities, knowledgeBase } from '../../src/knowledge'
import { communityScopeKey } from '../../src/knowledge/communities/keys'
import { createCommunityStore } from '../../src/knowledge/communities/store'
import type { KnowledgeModel } from '../../src/knowledge/model'
import type { CruxChunk } from '../../src/indexing'
import { inMemoryStorage } from '../../src/storage'

const ns = 'docs'

describe('connected knowledge community builds', () => {
  it('builds reports, covers fallback leaves, and reuses unchanged reports', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })

    await docs.index([
      chunk('alpha', 'a1', 'Alpha works with Beta.'),
      chunk('fallback', 'f1', 'plain residual evidence'),
    ])
    expect(await docs.communities?.status()).toBe('missing')
    await docs.communities?.prepare()

    const first = await docs.communities?.reports({ limit: 20 })
    const leaves = first?.reports.filter((report) => report.level === 0) ?? []
    expect(await docs.communities?.status()).toBe('ready')
    expect(leaves).toHaveLength(2)
    expect(new Set(leaves.flatMap((report) => report.findings.flatMap((finding) =>
      finding.evidence.filter((ref) => ref.kind === 'chunk').map((ref) => ref.sourceId),
    )))).toEqual(new Set(['alpha', 'fallback']))
    expect(leaves.reduce((sum, report) => sum + report.counts.chunks, 0)).toBe(2)

    model.reset()
    await docs.reindex([
      chunk('alpha', 'a1', 'Alpha works with Beta.'),
      chunk('fallback', 'f1', 'plain residual evidence'),
    ])
    await docs.communities?.prepare()

    expect(model.reportCalls()).toBe(0)
    expect((await docs.communities?.reports({ limit: 20 }))?.reports.map((report) => report.title)).toEqual(
      first?.reports.map((report) => report.title),
    )
  })

  it('regenerates only changed communities and dependent parents', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const docs = knowledgeBase({ id: ns, storage, communities: communities({ model }) })

    await docs.index([
      chunk('alpha', 'a1', 'Alpha works with Beta.'),
      chunk('fallback', 'f1', 'plain residual evidence'),
    ])
    await docs.communities?.prepare()

    model.reset()
    await docs.reindex([
      chunk('alpha', 'a1', 'Alpha now works with Gamma.'),
      chunk('fallback', 'f1', 'plain residual evidence'),
    ])
    await docs.communities?.prepare()

    expect(model.reportCalls()).toBe(2)
  })

  it('keeps view materializations scoped by revision', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const metadataSchema = z.object({ status: z.string() })
    const docs = knowledgeBase({ id: ns, storage, metadataSchema, communities: communities({ model }) })

    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.', { status: 'open' })])
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    const firstRevision = await view.resolve()
    await view.communities?.prepare()
    const firstGeneration = (await view.communities?.reports())?.reports[0]?.generationId

    await docs.index([chunk('second', 's1', 'Gamma works alone.', { status: 'open' })])
    await view.communities?.prepare()
    const liveGeneration = (await view.communities?.reports())?.reports[0]?.generationId
    const pinned = view.at(firstRevision.revisionHash)

    expect(liveGeneration).not.toBe(firstGeneration)
    await expect(pinned.communities?.status()).resolves.toBe('stale')
    await pinned.communities?.prepare()
    const pinnedGeneration = (await pinned.communities?.reports())?.reports[0]?.generationId
    expect(pinnedGeneration).not.toBe(liveGeneration)
  })

  it('fails invalid reports atomically and leaves the prior generation current', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })

    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()
    const before = (await docs.communities?.reports())?.reports[0]?.generationId

    model.failReports()
    await docs.reindex([chunk('alpha', 'a1', 'Alpha changed with Gamma.')])
    await expect(docs.communities?.prepare()).rejects.toThrow(/failed validation/)

    const scopeKey = communityScopeKey({ strategyFingerprint: config.strategyFingerprint })
    const store = createCommunityStore({ records: storage.records, indexerId: ns, namespace: ns, scopeKey })
    expect((await store.currentGeneration())?.generationId).toBe(before)
  })

  it('publishes empty views as ready with zero reports', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const metadataSchema = z.object({ status: z.string() })
    const docs = knowledgeBase({ id: ns, storage, metadataSchema, communities: communities({ model }) })

    await docs.index([chunk('closed', 'c1', 'Alpha works with Beta.', { status: 'closed' })])
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    await view.communities?.prepare()

    await expect(view.communities?.status()).resolves.toBe('ready')
    await expect(view.communities?.reports()).resolves.toEqual({ reports: [] })
  })

  it('reports missing, building, ready, and stale statuses and supports force rebuild', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })
    const scopeKey = communityScopeKey({ strategyFingerprint: config.strategyFingerprint })
    const store = createCommunityStore({ records: storage.records, indexerId: ns, namespace: ns, scopeKey })

    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    expect(await docs.communities?.status()).toBe('missing')
    await store.claimLease('test-owner')
    expect(await docs.communities?.status()).toBe('building')
    await store.releaseLease('test-owner')
    await docs.communities?.prepare()
    expect(await docs.communities?.status()).toBe('ready')

    const firstGeneration = (await store.currentGeneration())?.generationId
    await docs.index([chunk('second', 's1', 'Gamma works alone.')])
    expect(await docs.communities?.status()).toBe('stale')
    await docs.communities?.prepare({ force: true })
    expect((await store.currentGeneration())?.generationId).not.toBe(firstGeneration)
  })

  it('builds graph and communities when communities are the only connected feature', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const docs = knowledgeBase({ id: ns, storage, communities: communities({ model }) })

    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()

    expect(await storage.records.get(knowledgeCurrentKey(ns, ns))).toMatchObject({ namespace: ns })
    expect(model.relationCalls()).toBe(1)
    expect((await docs.communities?.reports({ level: 0 }))?.reports.length).toBeGreaterThan(0)
  })
})

function chunk(
  sourceId: string,
  chunkId: string,
  content: string,
  metadata: Record<string, unknown> = {},
): CruxChunk {
  return { namespace: ns, sourceId, chunkId, ordinal: 0, content, metadata }
}

function countingModel() {
  let relationCalls = 0
  let reportCalls = 0
  let fail = false
  const model = {
    name: 'community-test',
    fingerprint: 'community-test-v1',
    strategyFingerprint: '',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async (args: { readonly prompt: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) {
        relationCalls += 1
        return { object: entityOutput(args.prompt) }
      }
      reportCalls += 1
      if (fail) return { object: { title: 'invalid', summary: 'x', findings: [{ statement: 'missing evidence' }] } }
      return { object: reportOutput(args.prompt, reportCalls) }
    }),
    relationCalls: () => relationCalls,
    reportCalls: () => reportCalls,
    reset: () => {
      relationCalls = 0
      reportCalls = 0
    },
    failReports: () => {
      fail = true
    },
  } satisfies KnowledgeModel & {
    readonly strategyFingerprint: string
    relationCalls(): number
    reportCalls(): number
    reset(): void
    failReports(): void
  }
  return model
}

function entityOutput(prompt: string) {
  const mentions = [...prompt.matchAll(/\[([^\]]+)\]([^\[]+)/g)].flatMap((match) => {
    const chunkId = match[1] ?? ''
    const text = match[2] ?? ''
    return ['Alpha', 'Beta', 'Gamma'].filter((name) => text.includes(name)).map((name) => ({ chunkId, name }))
  })
  const names = [...new Set(mentions.map((item) => item.name))].sort()
  return {
    mentions,
    related: names.slice(1).map((name) => ({ from: names[0] ?? name, to: name })),
  }
}

function reportOutput(prompt: string, index: number) {
  const evidence = evidenceFromPrompt(prompt)
  return {
    title: `Community ${index}`,
    summary: `Summary ${index}`,
    findings: evidence.length > 0
      ? [{ statement: `Finding ${index}`, evidence }]
      : [],
  }
}

function evidenceFromPrompt(prompt: string) {
  const matches = [...prompt.matchAll(/chunk:([^:\s,\]]+):([^,\]\s]+)/g)]
  return matches.length > 0
    ? [{ kind: 'chunk' as const, sourceId: matches[0]?.[1] ?? '', chunkId: matches[0]?.[2] ?? '' }]
    : []
}
