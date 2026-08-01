import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  adapter,
  prompt,
  summarizable,
  type AdapterResponse,
  type AdapterSpec,
  type CallArgs,
} from '../../src'
import { embedding } from '../../src/embedding'
import { communities, knowledgeBase, type KnowledgeModel } from '../../src/knowledge'
import { createCommunityReportRecord, type CommunityReport } from '../../src/knowledge/communities/records'
import { communityScopeKey } from '../../src/knowledge/communities/keys'
import { createCommunityStore } from '../../src/knowledge/communities/store'
import { knowledgeCurrentKey } from '../../src/knowledge/keys'
import type { CruxChunk } from '../../src/indexing'
import { compilePrompt } from '../../src/resolver/compile'
import { createResolverFakes } from '../../src/resolver/fakes'
import { expandRelations, globalSearch, retriever, retrievalRecipe, retrieve, type RetrieverHit } from '../../src/retrieval'
import { inMemoryRecordStore, inMemoryStorage } from '../../src/storage'

describe('first-class retrieval recipe use entries', () => {
  it('injects bare bound recipe context from prompt input', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([chunk('refunds', 'main', 'Refund evidence')])
    const recipe = docs.recipe({ id: 'local-evidence', steps: [retrieve({ limit: 1 })] })
    const fakes = createResolverFakes()
    const answer = compilePrompt({
      id: 'bare-recipe',
      input: z.object({ question: z.string() }),
      use: [recipe],
      system: 'Base.',
    }, { ports: fakes.ports })

    const resolved = await answer.resolve({ input: { question: 'refund' } })

    expect(resolved.args.system).toContain('Refund evidence')
    expect(fakes.observability.contributionPreviews('active')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'injectable:local-evidence',
          injectableKind: 'retriever',
          injects: ['system'],
        }),
      ]),
    )
  })

  it('composes local and global recipes bare with stable contribution identities', async () => {
    const storage = inMemoryStorage()
    const model = knowledgeModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: 'docs', storage, embeddings: testEmbedding(), communities: config })
    await docs.index([
      chunk('local', 'main', 'Local renewal evidence'),
      chunk('neighbor', 'main', 'Neighbor renewal evidence'),
    ])
    await publishReports(storage.records, config.strategyFingerprint, [
      report('root', 'gen-1', 'Global renewal finding', 'local'),
    ])
    const localEvidence = docs.recipe({
      id: 'local-evidence',
      steps: [retrieve({ limit: 1 }), expandRelations({ limit: 1 })],
    })
    const globalFindings = docs.recipe({
      id: 'global-findings',
      steps: [globalSearch({ model, detail: 'overview', limit: 1 })],
    })
    const result = await requestHarness().runtime.generate(
      prompt({
        id: 'recipe-composition',
        input: z.object({ question: z.string() }),
        use: [localEvidence, globalFindings],
        prompt: 'Answer.',
      }),
      { model: 'model-1', input: { question: 'renewal' } },
    )

    const inspection = await result.steps[0]!.request!.inspect()
    expect(inspection.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'context:retrieval-recipe-context:local-evidence',
          sources: ['context:retrieval-recipe-context:local-evidence'],
        }),
        expect.objectContaining({
          id: 'context:retrieval-recipe-context:global-findings',
          sources: ['context:retrieval-recipe-context:global-findings'],
        }),
      ]),
    )
    const recipeSourceIds = inspection.contributions
      .map((item) => item.id)
      .filter((id) =>
        id === 'context:retrieval-recipe-context:local-evidence' ||
        id === 'context:retrieval-recipe-context:global-findings')
    expect(recipeSourceIds).toEqual(expect.arrayContaining([
      'context:retrieval-recipe-context:local-evidence',
      'context:retrieval-recipe-context:global-findings',
    ]))
    expect(new Set(recipeSourceIds).size).toBe(2)
  })

  it('plans summarizable(recipe) like summarizable(recipe.asContext())', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([chunk('guide', 'main', 'Large recipe content. '.repeat(120))])
    const recipe = docs.recipe({ id: 'summarized-recipe', steps: [retrieve({ limit: 1 })] })
    const handleRecords = inMemoryRecordStore()
    const contextRecords = inMemoryRecordStore()
    await runPlanned(handleRecords, [summarizable(recipe)])
    await runPlanned(contextRecords, [summarizable(recipe.asContext())])

    const fromHandle = await runPlanned(handleRecords, [summarizable(recipe)])
    const fromContext = await runPlanned(contextRecords, [summarizable(recipe.asContext())])

    expect(adaptationShapes(fromHandle.adaptations)).toEqual(adaptationShapes(fromContext.adaptations))
    expect(fromHandle.contributions).toEqual(fromContext.contributions)
  })

  it('keeps explicit asContext query override', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([
      chunk('pricing', 'main', 'Pricing evidence'),
      chunk('refunds', 'main', 'Refund evidence'),
    ])
    const recipe = docs.recipe({ id: 'override-recipe', steps: [retrieve({ limit: 1 })] })
    const answer = prompt({
      id: 'recipe-override',
      input: z.object({ question: z.string() }),
      use: [recipe.asContext({ query: 'pricing' })],
      system: 'Base.',
    })

    const resolved = await answer.resolve({ input: { question: 'refund' } })

    expect(resolved.system).toContain('Pricing evidence')
    expect(resolved.system).not.toContain('Refund evidence')
  })

  it('injects standalone retrievalRecipe context from prompt input', async () => {
    const source = retriever({
      id: 'source',
      namespace: 'source',
      retrieve: async (query) => [hit(String(query), `Standalone ${String(query)} evidence`)],
    })
    const recipe = retrievalRecipe({ id: 'standalone-recipe', retriever: source, steps: [retrieve()] })
    const answer = prompt({
      id: 'standalone-recipe-use',
      input: z.object({ message: z.string() }),
      use: [recipe],
      system: 'Base.',
    })

    const resolved = await answer.resolve({ input: { message: 'roadmap' } })

    expect(resolved.system).toContain('Standalone roadmap evidence')
  })
})

async function runPlanned(records: ReturnType<typeof inMemoryRecordStore>, use: Parameters<typeof prompt>[0]['use']) {
  const installation = (await import('../../src')).config({ storage: { records } })
  try {
    const result = await requestHarness((args) => args.system?.includes('source summarizer') ? 'Short summary.' : 'done')
      .runtime.generate(
        prompt({
          id: `planned-${Math.random()}`,
          input: z.object({ query: z.string() }),
          use,
          prompt: 'Answer.',
        }),
        { model: 'model-1', input: { query: 'guide' }, inputBudget: { optimizeAt: 640, max: 690 } },
      )
    const inspection = await result.steps[0]!.request!.inspect()
    return { adaptations: result.steps[0]!.request!.adaptations, contributions: inspection.contributions }
  } finally {
    installation.dispose()
  }
}

function adaptationShapes(adaptations: readonly {
  readonly contributor: string
  readonly representation: string
  readonly fullTokens: number
  readonly selectedTokens: number
}[]) {
  return adaptations.map(({ contributor, representation, fullTokens, selectedTokens }) => ({
    contributor,
    representation,
    fullTokens,
    selectedTokens,
  }))
}

function requestHarness(reply?: (args: CallArgs) => string) {
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: 'recipe-use-first-class-test',
    capacity: () => ({ contextWindow: 32_768, defaultOutputReserve: 256, countingConfidence: 'estimated' }),
    async call(_client, args) {
      const text = reply?.(args) ?? 'done'
      return { raw: { text }, extracted: response(text) }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  }
  return { runtime: adapter(spec)({}) }
}

function response(text: string): AdapterResponse {
  return { text, usage: undefined, finishReason: 'stop', responseId: 'response-1', actualModelId: 'model-1' }
}

function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'recipe-use-first-class-test',
    dimensions: 2,
    maxInputTokens: 10_000,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map(() => [1, 0]),
  })
}

function knowledgeModel() {
  return {
    name: 'recipe-use-first-class-test',
    fingerprint: 'recipe-use-first-class-test-v1',
    generateText: vi.fn(async () => ({ text: '' })),
    generateObject: vi.fn(async (args: { readonly prompt: string; readonly system?: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) {
        return { object: { mentions: [], related: [] } }
      }
      if (args.system?.includes('connected-knowledge findings')) {
        return { object: { findings: searchFindings(args.prompt) } }
      }
      return { object: { title: 'Community', summary: 'Summary', findings: [] } }
    }),
  } satisfies KnowledgeModel
}

function searchFindings(promptText: string) {
  const parsed = JSON.parse(promptText) as { communities: Array<{ findings: Array<{ id: string; statement: string }> }> }
  return parsed.communities.flatMap((community) =>
    community.findings.slice(0, 1).map((finding) => ({ statement: finding.statement, findingIds: [finding.id], score: 90 })),
  )
}

function chunk(sourceId: string, chunkId: string, content: string): CruxChunk {
  return { namespace: 'docs', sourceId, chunkId, ordinal: 0, content, metadata: {} }
}

function hit(sourceId: string, content: string): RetrieverHit {
  return { namespace: 'source', source: { id: sourceId }, chunkId: 'main', content, metadata: {}, score: 1, provenance: {} }
}

function report(communityId: string, generationId: string, statement: string, sourceId: string): CommunityReport {
  return createCommunityReportRecord({
    communityId,
    generationId,
    level: 1,
    title: communityId,
    summary: statement,
    findings: [{ id: 'finding-1', statement, evidence: [{ kind: 'chunk', sourceId, chunkId: 'main' }] }],
    lineage: { viewRevision: null, graphGeneration: 'graph-test', strategyFingerprint: 'strategy-test', memberHash: communityId },
    counts: { entities: 0, chunks: 1, assertions: 0 },
  })
}

async function publishReports(
  records: ReturnType<typeof inMemoryStorage>['records'],
  strategyFingerprint: string,
  reports: readonly CommunityReport[],
) {
  await records.put(knowledgeCurrentKey('docs', 'docs'), { namespace: 'docs', generationId: 'graph-test' })
  const store = createCommunityStore({
    records,
    indexerId: 'docs',
    namespace: 'docs',
    scopeKey: communityScopeKey({ strategyFingerprint }),
  })
  const generationId = reports[0]?.generationId ?? 'gen-empty'
  const writer = store.begin(generationId)
  for (const item of reports) {
    await writer.putReport({ ...item, lineage: { ...item.lineage, strategyFingerprint } })
    await writer.putLevelIndex({ generationId: item.generationId, communityId: item.communityId, level: item.level })
  }
  await writer.finish()
  await store.publish(generationId, {
    viewRevision: null,
    graphGeneration: 'graph-test',
    strategyFingerprint,
    memberHash: 'root',
  })
}
