import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import { knowledgeCurrentKey } from '../../src/knowledge/keys'
import { communities, knowledgeBase } from '../../src/knowledge'
import { communityScopeKey } from '../../src/knowledge/communities/keys'
import { createCommunityStore } from '../../src/knowledge/communities/store'
import type { KnowledgeModel } from '../../src/knowledge/model'
import type { CruxChunk } from '../../src/indexing'
import { inMemoryStorage } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

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
    await expect(docs.communities?.prepare()).rejects.toBeInstanceOf(ValidationExhaustedError)

    const scopeKey = communityScopeKey({ strategyFingerprint: config.strategyFingerprint })
    const store = createCommunityStore({ records: storage.records, indexerId: ns, namespace: ns, scopeKey })
    expect((await store.currentGeneration())?.generationId).toBe(before)
  })

  it('repairs once after canonical ValidationExhaustedError and keeps safe feedback', async () => {
    const storage = inMemoryStorage()
    const secret = 'leaked-rejected-title'
    const reportPrompts: string[] = []
    let reportCalls = 0
    const model = {
      name: 'community-repair-ok',
      fingerprint: 'community-repair-ok-v1',
      strategyFingerprint: '',
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject: vi.fn(async (args: { readonly prompt: string }) => {
        if (args.prompt.includes('Extract canonical entity names')) {
          return { object: entityOutput(args.prompt) }
        }
        reportCalls += 1
        reportPrompts.push(args.prompt)
        if (reportCalls === 1) {
          throw new ValidationExhaustedError({
            lastRawOutput: JSON.stringify({ title: secret }),
            zodErrors: communityReportInvalidZodError(),
            attempts: 0,
            maxAttempts: 0,
            promptId: 'generateObject',
          })
        }
        return { object: reportOutput(args.prompt, reportCalls) }
      }),
    } satisfies KnowledgeModel & { readonly strategyFingerprint: string }

    const docs = knowledgeBase({ id: ns, storage, communities: communities({ model }) })
    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()

    const reports = (await docs.communities?.reports({ limit: 20 }))?.reports ?? []
    expect(reports.length).toBeGreaterThan(0)
    expect(reportCalls).toBe(2)
    expect(reportPrompts[1]).toContain('Fix these validation errors:')
    expect(reportPrompts[1]).toMatch(/findings\.\[0\]\.evidence|title|invalid_type|invalid_union|too_small/)
    expect(reportPrompts[1]).not.toContain(secret)
    expect(reportPrompts[1]).not.toContain('leaked')
  })

  it('throws ValidationExhaustedError after one failed repair without partial publication', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })

    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()
    const before = (await docs.communities?.reports())?.reports[0]?.generationId
    const reportCallsBefore = model.reportCalls()

    model.failWithValidationExhaustion()
    await docs.reindex([chunk('alpha', 'a1', 'Alpha changed with Gamma.')])
    const error = await docs.communities?.prepare().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect(error).toMatchObject({ attempts: 1, maxAttempts: 1 })
    // Bottom-up generation aborts at the first community that exhausts repair:
    // one initial ValidationExhaustedError + exactly one domain repair attempt.
    expect(model.reportCalls() - reportCallsBefore).toBe(2)

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
  return schema2TextChunk({ namespace: ns, sourceId, chunkId, ordinal: 0, content, metadata })
}

function countingModel() {
  let relationCalls = 0
  let reportCalls = 0
  let fail: 'none' | 'invalid-object' | 'validation-exhausted' = 'none'
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
      if (fail === 'invalid-object') {
        return { object: { title: 'invalid', summary: 'x', findings: [{ statement: 'missing evidence' }] } }
      }
      if (fail === 'validation-exhausted') {
        throw new ValidationExhaustedError({
          lastRawOutput: '{"title":"invalid"}',
          zodErrors: communityReportInvalidZodError(),
          attempts: 0,
          maxAttempts: 0,
          promptId: 'generateObject',
        })
      }
      return { object: reportOutput(args.prompt, reportCalls) }
    }),
    relationCalls: () => relationCalls,
    reportCalls: () => reportCalls,
    reset: () => {
      relationCalls = 0
      reportCalls = 0
    },
    failReports: () => {
      fail = 'invalid-object'
    },
    failWithValidationExhaustion: () => {
      fail = 'validation-exhausted'
    },
  } satisfies KnowledgeModel & {
    readonly strategyFingerprint: string
    relationCalls(): number
    reportCalls(): number
    reset(): void
    failReports(): void
    failWithValidationExhaustion(): void
  }
  return model
}

function communityReportInvalidZodError(): z.ZodError {
  const parsed = z.object({
    title: z.string().min(1),
    summary: z.string(),
    findings: z.array(z.object({
      statement: z.string().min(1),
      evidence: z.array(z.object({ kind: z.literal('chunk'), sourceId: z.string(), chunkId: z.string() })).min(1),
    })),
  }).safeParse({
    title: 'invalid',
    summary: 'x',
    findings: [{ statement: 'missing evidence' }],
  })
  if (parsed.success) throw new Error('expected invalid community report fixture')
  return parsed.error
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
