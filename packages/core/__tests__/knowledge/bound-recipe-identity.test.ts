import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { embedding } from '../../src/embedding'
import { knowledgeModel } from '../../src/knowledge'
import {
  compressToBudget,
  expandParents,
  expandRelations,
  fanout,
  judgeReranker,
  knowledgeBase,
  rerank,
  retrieve,
  rewriteQuery,
  type RetrievalModel,
} from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'

const schema = z.object({
  status: z.enum(['open', 'closed']),
  team: z.string(),
})

describe('bound recipe identity', () => {
  it('gives structurally identical anonymous knowledge-base recipes the same id and fingerprint', async () => {
    const docs = createDocs()

    const left = docs.recipe({
      steps: [retrieve({ limit: 2 }), expandRelations({ types: ['related'], direction: 'out' })],
    })
    const right = docs.recipe({
      steps: [retrieve({ limit: 2 }), expandRelations({ types: ['related'], direction: 'out' })],
    })

    expect(left.id).toBe(right.id)
    expect(left.fingerprint).toBe(right.fingerprint)

    const result = await left.retrieveWithTrace('empty')
    expect(result.trace.fingerprint).toBe(left.fingerprint)
  })

  it('changes the behavioral fingerprint when steps, config, or model identity changes', () => {
    const docs = createDocs()
    const modelA = testModel('rewrite-a', 'fingerprint-a')
    const modelB = testModel('rewrite-b', 'fingerprint-b')
    const engine = judgeReranker({ name: 'identity-reranker', model: modelA })

    const base = docs.recipe({ steps: [retrieve({ limit: 1 })] })
    const changedConfig = docs.recipe({ steps: [retrieve({ limit: 2 })] })
    const changedSteps = docs.recipe({ steps: [retrieve({ limit: 1 }), expandRelations({ depth: 2 })] })
    const changedModelA = docs.recipe({ model: modelA, steps: [rewriteQuery()] })
    const changedModelB = docs.recipe({ model: modelB, steps: [rewriteQuery()] })
    const changedFanoutConfig = docs.recipe({ model: modelA, steps: [fanout({ maxQueries: 2 }), retrieve()] })
    const changedRerankConfig = docs.recipe({ steps: [retrieve(), rerank({ engine, topK: 1 })] })
    const changedParentConfig = docs.recipe({ steps: [retrieve(), expandParents({ maxParentChars: 200 })] })
    const changedCompressConfig = docs.recipe({ model: modelA, steps: [retrieve(), compressToBudget({ tokens: 100, model: modelA })] })

    expect(changedConfig.fingerprint).not.toBe(base.fingerprint)
    expect(changedSteps.fingerprint).not.toBe(base.fingerprint)
    expect(changedModelB.fingerprint).not.toBe(changedModelA.fingerprint)
    expect(changedFanoutConfig.fingerprint).not.toBe(docs.recipe({ model: modelA, steps: [fanout({ maxQueries: 3 }), retrieve()] }).fingerprint)
    expect(changedRerankConfig.fingerprint).not.toBe(docs.recipe({ steps: [retrieve(), rerank({ engine, topK: 2 })] }).fingerprint)
    expect(changedParentConfig.fingerprint).not.toBe(docs.recipe({ steps: [retrieve(), expandParents({ maxParentChars: 300 })] }).fingerprint)
    expect(changedCompressConfig.fingerprint).not.toBe(docs.recipe({ model: modelA, steps: [retrieve(), compressToBudget({ tokens: 120, model: modelA })] }).fingerprint)
  })

  it('keeps the same steps distinct across view read surfaces', () => {
    const docs = createDocs()
    const open = docs.view({ id: 'open', where: { status: 'open' } })
    const closed = docs.view({ id: 'closed', where: { status: 'closed' } })

    const openRecipe = open.recipe({ steps: [retrieve({ limit: 1 })] })
    const closedRecipe = closed.recipe({ steps: [retrieve({ limit: 1 })] })

    expect(openRecipe.fingerprint).toBe(closedRecipe.fingerprint)
    expect(openRecipe.id).not.toBe(closedRecipe.id)
  })

  it('preserves explicit recipe ids', () => {
    const docs = createDocs()
    const view = docs.view({ id: 'open', where: { status: 'open' } })

    expect(docs.recipe({ id: 'manual-docs', steps: [retrieve()] }).id).toBe('manual-docs')
    expect(view.recipe({ id: 'manual-view', steps: [retrieve()] }).id).toBe('manual-view')
    expect(() => docs.recipe({ id: '', steps: [retrieve()] })).toThrow('Retrieval recipe id must be non-empty.')
    expect(() => view.recipe({ id: '', steps: [retrieve()] })).toThrow('Retrieval recipe id must be non-empty.')
  })

  it('requires stable model identity for anonymous bound recipes', () => {
    const docs = createDocs()
    const model = rawModel()

    expect(() => docs.recipe({ model, steps: [rewriteQuery()] })).toThrow(/model name and fingerprint/)
    expect(() => docs.recipe({ steps: [rewriteQuery({ model })] })).toThrow(/model name and fingerprint/)
    expect(docs.recipe({ id: 'manual-raw-model', model, steps: [rewriteQuery()] }).id).toBe('manual-raw-model')
  })

  it('survives independent handle construction', () => {
    const first = createAnonymousRecipe()
    const second = createAnonymousRecipe()

    expect(second.id).toBe(first.id)
    expect(second.fingerprint).toBe(first.fingerprint)
  })
})

function createDocs() {
  return knowledgeBase({
    id: 'docs',
    storage: inMemoryStorage(),
    embeddings: embedding({
      kind: 'dense',
      name: 'bound-recipe-identity',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map(() => [1, 0]),
    }),
    metadataSchema: schema,
  })
}

function createAnonymousRecipe() {
  return createDocs().recipe({
    steps: [retrieve({ limit: 2 }), expandRelations({ types: ['related'], direction: 'out' })],
  })
}

function testModel(name: string, fingerprint: string) {
  return knowledgeModel({
    name,
    fingerprint,
    generateText: async () => ({ text: '' }),
    generateObject: async () => ({ object: {} }) as never,
  })
}

function rawModel(): RetrievalModel {
  return {
    generateText: async () => ({ text: '' }),
    generateObject: async () => ({ object: {} }) as never,
  }
}
