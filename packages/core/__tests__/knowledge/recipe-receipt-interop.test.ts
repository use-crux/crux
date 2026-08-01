import { describe, expect, it, vi } from 'vitest'
import { adapter, prompt, type AdapterResponse, type AdapterSpec, type CallArgs } from '../../src'
import { embedding } from '../../src/embedding'
import { communities, knowledgeBase, type KnowledgeModel } from '../../src/knowledge'
import { globalSearch } from '../../src/retrieval'
import type { CruxChunk } from '../../src/indexing'
import { inMemoryStorage } from '../../src/storage'

describe('knowledge recipe request receipts', () => {
  it('projects real recipe trace knowledge into request inspection', async () => {
    const model = knowledgeModel()
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: testEmbedding(),
      communities: communities({ model }),
    })
    await docs.index([chunk('alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()

    const recipe = docs.recipe({ steps: [globalSearch({ model, detail: 'overview' })] })
    const result = await requestHarness().runtime.generate(
      prompt({
        id: 'recipe-knowledge-receipt',
        use: [recipe.asContext({ query: 'alpha beta' })],
        prompt: 'Answer.',
      }),
      { model: 'model-1' },
    )

    const inspection = await result.steps[0]!.request!.inspect()
    expect(inspection.knowledge).toEqual([
      expect.objectContaining({
        recipeId: recipe.id,
        fingerprint: recipe.fingerprint,
        stepId: 'global-search',
        contributor: 'global-search',
        coverage: 'exact',
        detail: 'overview',
        counts: {
          available: { reports: expect.any(Number), findings: expect.any(Number) },
          processed: { reports: expect.any(Number), findings: expect.any(Number) },
        },
      }),
    ])
    expect(JSON.stringify(inspection)).not.toContain('alpha beta')
  })
})

function requestHarness() {
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: 'knowledge-recipe-receipt-test',
    capacity: () => ({ contextWindow: 32_768, defaultOutputReserve: 256, countingConfidence: 'estimated' }),
    async call(_client, _args: CallArgs) {
      return { raw: { text: 'done' }, extracted: response('done') }
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
    name: 'knowledge-recipe-receipt-test',
    dimensions: 2,
    maxInputTokens: 10_000,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map(() => [1, 0]),
  })
}

function knowledgeModel() {
  let searchCalls = 0
  return {
    name: 'knowledge-recipe-receipt-test',
    fingerprint: 'knowledge-recipe-receipt-test-v1',
    generateText: vi.fn(async () => ({ text: '' })),
    generateObject: vi.fn(async (args: { readonly prompt: string; readonly system?: string }) => {
      if (args.prompt.includes('Extract canonical entity names')) {
        return { object: { mentions: [{ chunkId: 'a1', name: 'Alpha' }], related: [] } }
      }
      if (args.system?.includes('connected-knowledge findings')) {
        searchCalls += 1
        return { object: { findings: searchFindings(args.prompt) } }
      }
      return { object: { title: 'Community', summary: 'Summary', findings: [{
        statement: 'Finding from report',
        evidence: [{ kind: 'chunk', sourceId: 'alpha', chunkId: 'a1' }],
      }] } }
    }),
    searchCalls: () => searchCalls,
  } satisfies KnowledgeModel & { searchCalls(): number }
}

function searchFindings(prompt: string) {
  const parsed = JSON.parse(prompt) as { communities: Array<{ findings: Array<{ id: string; statement: string }> }> }
  return parsed.communities.flatMap((community) =>
    community.findings.slice(0, 1).map((finding) => ({
      statement: finding.statement,
      findingIds: [finding.id],
      score: 90,
    })),
  )
}

function chunk(sourceId: string, chunkId: string, content: string): CruxChunk {
  return { namespace: 'docs', sourceId, chunkId, ordinal: 0, content, metadata: {} }
}
