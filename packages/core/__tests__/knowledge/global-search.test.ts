import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { communities, knowledgeBase, type KnowledgeModel } from '../../src/knowledge'
import { createCommunityReportRecord, type CommunityReport } from '../../src/knowledge/communities/records'
import { communityScopeKey } from '../../src/knowledge/communities/keys'
import { createCommunityStore } from '../../src/knowledge/communities/store'
import { knowledgeCurrentKey } from '../../src/knowledge/keys'
import { globalSearch, retrieve } from '../../src/retrieval'
import type { CruxChunk } from '../../src/indexing'
import { inMemoryStorage } from '../../src/storage'

const ns = 'docs'

describe('globalSearch()', () => {
  it('returns finding hits with citations and exact coverage receipts', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const docs = knowledgeBase({ id: ns, storage, communities: communities({ model }) })
    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()

    const recipe = docs.recipe({ steps: [globalSearch({ model, detail: 'detailed', limit: 3 })] })
    const { hits, trace } = await recipe.retrieveWithTrace('alpha beta')

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'finding',
      namespace: ns,
      content: expect.stringContaining('Finding'),
      citation: {
        supports: [{ kind: 'chunk', sourceId: 'alpha', chunkId: 'a1' }],
        lineage: { viewRevision: null, reportCommunityId: expect.any(String) },
      },
    })
    expect(trace.steps[0]?.knowledge).toMatchObject({
      contributor: 'global-search',
      coverage: 'exact',
      detail: 'detailed',
      preflight: { calls: 1 },
    })
  })

  it('selects overview and detailed report levels deterministically', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })
    await publishReports(storage.records, config.strategyFingerprint, [
      report('root', 'gen-fixed', 1, undefined, 'Root summary', 'root finding', 'alpha'),
      report('leaf-a', 'gen-fixed', 0, 'root', 'Leaf A summary', 'leaf a finding', 'alpha'),
      report('leaf-b', 'gen-fixed', 0, 'root', 'Leaf B summary', 'leaf b finding', 'beta'),
    ])

    await docs.recipe({ steps: [globalSearch({ model, detail: 'overview' })] }).retrieve('query')
    await docs.recipe({ steps: [globalSearch({ model, detail: 'detailed' })] }).retrieve('query')

    expect(model.searchCommunities(0)).toEqual(['root'])
    expect(model.searchCommunities(1)).toEqual(['leaf-a', 'leaf-b'])
  })

  it('fails preflight before map calls when the ceiling is exceeded', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })
    await publishReports(storage.records, config.strategyFingerprint, Array.from({ length: 400 }, (_, index) =>
      report(`leaf-${index.toString().padStart(3, '0')}`, 'gen-large', 0, undefined, 'x'.repeat(2_000), 'y'.repeat(500), `s${index}`),
    ))

    const recipe = docs.recipe({ steps: [globalSearch({ model, detail: 'detailed' })] })
    await expect(recipe.retrieve('query')).rejects.toThrow(/above the 32 call ceiling.*overview.*adaptive.*narrower view/)
    expect(model.searchCalls()).toBe(0)
  })

  it('retries invalid map output once and fails atomically', async () => {
    const storage = inMemoryStorage()
    const model = countingModel({ invalidSearch: true })
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })
    await publishReports(storage.records, config.strategyFingerprint, [
      report('leaf', 'gen-fail', 0, undefined, 'Summary', 'finding', 'alpha'),
    ])

    const recipe = docs.recipe({ steps: [globalSearch({ model, detail: 'detailed' })] })
    await expect(recipe.retrieve('query')).rejects.toThrow(/failed validation after repair/)
    expect(model.searchCalls()).toBe(2)
  })

  it('rejects request filters and two producer recipes', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const docs = knowledgeBase({ id: ns, storage, communities: communities({ model }) })
    const recipe = docs.recipe({ steps: [globalSearch({ model })] })

    await expect(recipe.retrieve({ query: 'query', filter: { team: 'docs' } })).rejects.toThrow(/does not accept request filters/)
    expect(model.searchCalls()).toBe(0)
    expect(() => docs.recipe({ steps: [retrieve(), globalSearch({ model })] })).toThrow(/more than one producer step.*retrieve.*global-search/)
  })

  it('receipts raw fallback for small never-built views and compensated additions', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const metadataSchema = z.object({ status: z.string() })
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, metadataSchema, communities: config })
    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.', { status: 'open' })])
    const view = docs.view({ id: 'open', where: { status: 'open' } })

    const raw = await view.recipe({ steps: [globalSearch({ model, detail: 'detailed' })] }).retrieveWithTrace('alpha')
    expect(raw.trace.steps[0]?.knowledge?.coverage).toBe('raw-fallback')

    await view.communities?.prepare({ force: true })
    await docs.index([chunk('beta', 'b1', 'Beta works with Gamma.', { status: 'open' })])
    const compensated = await view.recipe({ steps: [globalSearch({ model, detail: 'detailed' })] }).retrieveWithTrace('beta')
    expect(compensated.trace.steps[0]?.knowledge).toMatchObject({
      coverage: 'compensated',
      view: { id: 'open', viewRevision: expect.any(String) },
    })
  })

  it('receipts adaptive descent and pass-through warnings for finding hits', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: ns, storage, communities: config })
    await publishReports(storage.records, config.strategyFingerprint, [
      report('root', 'gen-adaptive', 1, undefined, 'Root', 'root finding', 'alpha'),
      report('leaf', 'gen-adaptive', 0, 'root', 'Leaf', 'leaf finding', 'alpha'),
    ])

    const adaptive = await docs.recipe({ steps: [globalSearch({ model, scan: 'adaptive', detail: 'overview' })] }).retrieveWithTrace('query')
    expect(adaptive.trace.steps[0]?.knowledge?.adaptive).toMatchObject({ threshold: 50, visited: [{ communityId: 'root' }] })

    const pass = await docs.recipe({
      steps: [
        globalSearch({ model, detail: 'overview' }),
        await import('../../src/retrieval').then((mod) => mod.expandParents({ records: storage.records, indexerId: ns })),
        await import('../../src/retrieval').then((mod) => mod.expandRelations({ limit: 1 })),
      ],
    }).retrieveWithTrace('query')
    expect(pass.trace.warnings).toContain('expandParents skipped 1 finding hit.')
    expect(pass.trace.warnings).toContain('expandRelations skipped 1 finding hit.')
  })
})

function chunk(sourceId: string, chunkId: string, content: string, metadata: Record<string, unknown> = {}): CruxChunk {
  return { namespace: ns, sourceId, chunkId, ordinal: 0, content, metadata }
}

function countingModel(options: { readonly invalidSearch?: boolean } = {}) {
  let searchCallCount = 0
  const prompts: string[][] = []
  const model = {
    name: 'global-search-test',
    fingerprint: 'global-search-test-v1',
    generateText: vi.fn(async () => ({ text: '' })),
    generateObject: vi.fn(async (args: { readonly prompt: string; readonly system?: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) return { object: entityOutput(args.prompt) }
      if (args.system?.includes('connected-knowledge findings')) {
        searchCallCount += 1
        if (options.invalidSearch) return { object: { findings: [{ statement: 'bad', findingIds: ['missing'], score: 90 }] } }
        const communitiesInPrompt = searchCommunities(args.prompt)
        prompts.push(communitiesInPrompt)
        return { object: { findings: searchFindings(args.prompt) } }
      }
      return { object: reportOutput(args.prompt) }
    }),
    searchCalls: () => searchCallCount,
    searchCommunities: (index: number) => prompts[index] ?? [],
  } satisfies KnowledgeModel & {
    searchCalls(): number
    searchCommunities(index: number): readonly string[]
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
  return { mentions, related: names.slice(1).map((name) => ({ from: names[0] ?? name, to: name })) }
}

function reportOutput(prompt: string) {
  const evidence = evidenceFromPrompt(prompt)
  return {
    title: 'Community report',
    summary: 'Community summary',
    findings: evidence.length ? [{ statement: 'Finding from report', evidence }] : [],
  }
}

function searchFindings(prompt: string) {
  const parsed = JSON.parse(prompt) as { communities: Array<{ communityId: string; findings: Array<{ id: string; statement: string }> }> }
  return parsed.communities.flatMap((community) =>
    community.findings.slice(0, 1).map((finding) => ({
      statement: finding.statement,
      findingIds: [finding.id],
      score: 90,
    })),
  )
}

function searchCommunities(prompt: string): string[] {
  const parsed = JSON.parse(prompt) as { communities: Array<{ communityId: string }> }
  return parsed.communities.map((community) => community.communityId)
}

function evidenceFromPrompt(prompt: string) {
  const matches = [...prompt.matchAll(/chunk:([^:\s,\]]+):([^,\]\s]+)/g)]
  return matches.length
    ? [{ kind: 'chunk' as const, sourceId: matches[0]?.[1] ?? '', chunkId: matches[0]?.[2] ?? '' }]
    : []
}

function report(
  communityId: string,
  generationId: string,
  level: number,
  parentCommunityId: string | undefined,
  summary: string,
  statement: string,
  sourceId: string,
): CommunityReport {
  return createCommunityReportRecord({
    communityId,
    generationId,
    level,
    ...(parentCommunityId ? { parentCommunityId } : {}),
    title: communityId,
    summary,
    findings: [{ id: 'finding-1', statement, evidence: [{ kind: 'chunk', sourceId, chunkId: 'c1' }] }],
    lineage: { viewRevision: null, graphGeneration: 'graph-test', strategyFingerprint: 'strategy-test', memberHash: communityId },
    counts: { entities: 0, chunks: 1, assertions: 0 },
  })
}

async function publishReports(records: ReturnType<typeof inMemoryStorage>['records'], strategyFingerprint: string, reports: readonly CommunityReport[]) {
  await records.put(knowledgeCurrentKey(ns, ns), { namespace: ns, generationId: 'graph-test' })
  const scopeKey = communityScopeKey({ strategyFingerprint })
  const store = createCommunityStore({ records, indexerId: ns, namespace: ns, scopeKey })
  const writer = store.begin(reports[0]?.generationId ?? 'gen-empty')
  for (const item of reports) {
    await writer.putReport({ ...item, lineage: { ...item.lineage, strategyFingerprint } })
    await writer.putLevelIndex({
      generationId: item.generationId,
      communityId: item.communityId,
      level: item.level,
      ...(item.parentCommunityId ? { parentCommunityId: item.parentCommunityId } : {}),
    })
  }
  await writer.finish()
  await store.publish(reports[0]?.generationId ?? 'gen-empty', {
    viewRevision: null,
    graphGeneration: 'graph-test',
    strategyFingerprint,
    memberHash: 'root',
  })
}
