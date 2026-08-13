import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import type { CruxChunk } from '../../src/indexing'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { knowledgeBase, retriever as makeRetriever, retrievalRecipe, retrievalStep } from '../../src/retrieval'
import type { RetrieverHit } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

describe('recipe knowledge binding', () => {
  it('binds graph reading and hit hydration inside knowledge-base recipes', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createEmbedding(),
    })
    await docs.index([
      chunk({
        namespace: 'docs',
        sourceId: 'guide',
        chunkId: 'intro',
        content: 'Connected knowledge guide',
        metadata: { topic: 'connected' },
      }),
      chunk({
        namespace: 'docs',
        sourceId: 'guide',
        chunkId: 'appendix',
        content: 'Private appendix',
        metadata: { topic: 'private' },
        ordinal: 2,
      }),
    ])

    const observations: Array<{
      namespace: string
      neighbors: readonly { readonly ref: KnowledgeRef; readonly type: string; readonly direction: 'out' | 'in' }[]
      hydrated: readonly (RetrieverHit | null)[]
    }> = []
    const recipe = docs.recipe({
      id: 'knowledge-aware',
      steps: [
        retrievalStep({
          id: 'observe-knowledge',
          phase: { in: 'queries', out: 'hits' },
          async run(_, context) {
            if (!context.knowledge) throw new Error('Expected a knowledge binding.')
            const neighbors = await context.knowledge.reader.neighbors(documentRef('guide'), {
              types: ['hierarchy'],
              direction: 'out',
            })
            const hydrated = await Promise.all(neighbors.map((neighbor) => context.knowledge!.hydrate(neighbor.ref)))
            observations.push({ namespace: context.knowledge.namespace, neighbors, hydrated })
            return { hits: hydrated.filter(isHit) }
          },
        }),
      ],
    })

    await expect(recipe.retrieve('guide', { filter: { topic: 'connected' } })).resolves.toEqual([
      expect.objectContaining({
        namespace: 'docs',
        source: { id: 'guide' },
        chunkId: 'intro',
        content: 'Connected knowledge guide',
      }),
    ])
    expect(observations).toEqual([
      {
        namespace: 'docs',
        neighbors: [
          { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out' },
          { ref: chunkRef('guide', 'appendix'), type: 'hierarchy', direction: 'out' },
        ],
        hydrated: [
          expect.objectContaining({
            namespace: 'docs',
            source: { id: 'guide' },
            chunkId: 'intro',
          }),
          null,
        ],
      },
    ])
  })

  it('leaves standalone retrieval recipes unbound', async () => {
    const source = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [],
    })
    let observed: unknown = 'unset'
    const recipe = retrievalRecipe({
      id: 'standalone',
      retriever: source,
      steps: [
        retrievalStep({
          id: 'observe-knowledge',
          phase: { in: 'queries', out: 'hits' },
          run(_, context) {
            observed = context.knowledge
            return { hits: [] }
          },
        }),
      ],
    })

    await expect(recipe.retrieve('guide')).resolves.toEqual([])
    expect(observed).toBeUndefined()
  })

  it('binds scoped knowledge-base recipes to the scoped namespace', async () => {
    const root = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createEmbedding(),
    })
    const scoped = root.scope({ namespace: 'tenant-a' })
    await scoped.index([
      chunk({
        namespace: 'tenant-a',
        sourceId: 'guide',
        chunkId: 'tenant-intro',
        content: 'Tenant guide',
      }),
    ])

    let observedNamespace: string | undefined
    const recipe = scoped.recipe({
      id: 'scoped-knowledge',
      steps: [
        retrievalStep({
          id: 'observe-knowledge',
          phase: { in: 'queries', out: 'hits' },
          async run(_, context) {
            if (!context.knowledge) throw new Error('Expected a scoped knowledge binding.')
            observedNamespace = context.knowledge.namespace
            const neighbors = await context.knowledge.reader.neighbors(documentRef('guide'), {
              types: ['hierarchy'],
              direction: 'out',
            })
            const hydrated = await Promise.all(neighbors.map((neighbor) => context.knowledge!.hydrate(neighbor.ref)))
            return { hits: hydrated.filter(isHit) }
          },
        }),
      ],
    })

    await expect(recipe.retrieve('guide')).resolves.toEqual([
      expect.objectContaining({
        namespace: 'tenant-a',
        source: { id: 'guide' },
        chunkId: 'tenant-intro',
      }),
    ])
    expect(observedNamespace).toBe('tenant-a')
  })
})

function createEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'recipe-knowledge-test',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map(() => [1, 0]),
  })
}

function chunk(input: {
  readonly namespace: string
  readonly sourceId: string
  readonly chunkId: string
  readonly content: string
  readonly metadata?: Record<string, unknown>
  readonly ordinal?: number
}): CruxChunk {
  return schema2TextChunk({
    namespace: input.namespace,
    sourceId: input.sourceId,
    chunkId: input.chunkId,
    ordinal: input.ordinal ?? 1,
    content: input.content,
    metadata: input.metadata ?? {},
  })
}

function documentRef(sourceId: string): KnowledgeRef {
  return { kind: 'document', sourceId }
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function isHit(hit: RetrieverHit | null): hit is RetrieverHit {
  return hit !== null
}
