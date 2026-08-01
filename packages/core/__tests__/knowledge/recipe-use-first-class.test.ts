import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  prompt,
  summarizable,
  type CallArgs,
} from '../../src'
import { communities, knowledgeBase } from '../../src/knowledge'
import { compilePrompt } from '../../src/resolver/compile'
import { createResolverFakes } from '../../src/resolver/fakes'
import { expandRelations, globalSearch, retriever, retrievalRecipe, retrieve } from '../../src/retrieval'
import { inMemoryRecordStore, inMemoryStorage } from '../../src/storage'
import {
  chunk,
  hit,
  knowledgeModel,
  publishReports,
  report,
  requestHarness,
  testEmbedding,
} from './recipe-test-helpers'

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
    expect(recipeSourceIds).toHaveLength(2)
    expect(new Set(recipeSourceIds).size).toBe(2)
  })

  it('plans summarizable(recipe) like summarizable(recipe.asContext())', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([chunk('guide', 'main', 'Large recipe content. '.repeat(120))])
    const recipe = docs.recipe({ id: 'summarized-recipe', steps: [retrieve({ limit: 1 })] })
    const handleRecords = inMemoryRecordStore()
    const contextRecords = inMemoryRecordStore()
    const preparedFromHandle = await runPlanned(handleRecords, [summarizable(recipe)])
    await runPlanned(contextRecords, [summarizable(recipe.asContext())])

    const fromHandle = await runPlanned(handleRecords, [summarizable(recipe)])
    const fromContext = await runPlanned(contextRecords, [summarizable(recipe.asContext())])
    const expectedSource = 'context:retrieval-recipe-context:summarized-recipe'

    expect(fromHandle.adaptations).toEqual([
      expect.objectContaining({
        contributor: 'retrieval-recipe-context:summarized-recipe',
        representation: 'summary',
      }),
    ])
    expect(preparedFromHandle.summaryCalls).toHaveLength(1)
    expect(fromHandle.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'retrieval-recipe-context:summarized-recipe',
          sources: [expectedSource],
          representations: expect.arrayContaining(['full', 'summary']),
        }),
      ]),
    )

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

  it('derives the recipe query from a prompt input field', async () => {
    const source = retriever({
      id: 'prompt-source',
      namespace: 'prompt-source',
      retrieve: async (query) => [hit(String(query), `Prompted ${String(query)} evidence`)],
    })
    const recipe = retrievalRecipe({ id: 'prompt-field-recipe', retriever: source, steps: [retrieve()] })
    const answer = prompt({
      id: 'prompt-field-recipe-use',
      input: z.object({ prompt: z.string() }),
      use: [recipe],
      system: 'Base.',
    })

    const resolved = await answer.resolve({ input: { prompt: 'billing' } })

    expect(resolved.system).toContain('Prompted billing evidence')
  })
})

async function runPlanned(records: ReturnType<typeof inMemoryRecordStore>, use: Parameters<typeof prompt>[0]['use']) {
  const installation = (await import('../../src')).config({ storage: { records } })
  const summaryCalls: CallArgs[] = []
  try {
    const result = await requestHarness((args) => {
      if (args.system?.includes('source summarizer')) {
        summaryCalls.push(args)
        return 'Short summary.'
      }
      return 'done'
    })
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
    return {
      adaptations: result.steps[0]!.request!.adaptations,
      contributions: inspection.contributions,
      summaryCalls,
    }
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
