import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import type { CruxChunk } from '../../src/indexing'
import type { KnowledgeNeighbor } from '../../src/knowledge/graph-types'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { expandRelations, knowledgeBase, retrieve } from '../../src/retrieval'
import type { RetrieverHit, RetrievalStepContext } from '../../src/retrieval'
import type { RetrievalKnowledgeBinding } from '../../src/retrieval/recipe/knowledge-binding'
import { inMemoryStorage } from '../../src/storage'

describe('expandRelations', () => {
  it('throws an actionable error when no knowledge binding is present', async () => {
    await expect(expandRelations().run({ hits: [] }, stepContext())).rejects.toThrow(
      /knowledgeBase\(\)\.recipe.*view recipe/,
    )
  })

  it('preserves incoming hit order and appends structural relation hits in recipes', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createEmbedding(),
    })
    await docs.index([
      chunk({ chunkId: 'intro', ordinal: 1, content: 'Intro' }),
      chunk({ chunkId: 'details', ordinal: 2, content: 'Details' }),
    ])
    const recipe = docs.recipe({
      id: 'expand-structural',
      steps: [
        retrieve({ limit: 1 }),
        expandRelations({ types: ['sequence'], direction: 'out' }),
      ],
    })

    const hits = await recipe.retrieve('intro')

    expect(hits.map((hit) => hit.chunkId)).toEqual(['intro', 'details'])
    expect(graphOf(hits[1])).toEqual({
      seed: 'chunk:guide:intro',
      path: ['chunk:guide:intro', 'chunk:guide:details'],
      edges: ['sequence'],
      distance: 1,
    })
  })

  it('uses binding hydration visibility and keeps traversing through skipped refs', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createEmbedding(),
    })
    await docs.index([
      chunk({ chunkId: 'public-a', ordinal: 1, content: 'Public A', metadata: { access: 'public' } }),
      chunk({ chunkId: 'private', ordinal: 2, content: 'Private', metadata: { access: 'private' } }),
      chunk({ chunkId: 'public-b', ordinal: 3, content: 'Public B', metadata: { access: 'public' } }),
    ])
    const recipe = docs.recipe({
      id: 'expand-visible',
      steps: [
        retrieve({ limit: 1 }),
        expandRelations({ types: ['sequence'], direction: 'out', depth: 2 }),
      ],
    })

    const hits = await recipe.retrieve('Public A', { filter: { access: 'public' } })

    expect(hits.map((hit) => hit.chunkId)).toEqual(['public-a', 'public-b'])
    expect(graphOf(hits[1])?.path).toEqual([
      'chunk:guide:public-a',
      'chunk:guide:private',
      'chunk:guide:public-b',
    ])
  })

  it('keeps query seeding deterministic and resolves no query seeds before entity aliases exist', async () => {
    const calls: unknown[] = []
    const step = expandRelations({ seeds: ['query'] })
    const input = [hit('docs', 'guide', 'intro')]

    const result = await step.run({ hits: input }, stepContext(binding({
      neighbors: async (...args) => {
        calls.push(args)
        return [neighbor(chunkRef('guide', 'other'))]
      },
      hydrate: async () => hit('docs', 'guide', 'other'),
    })))

    expect(result.hits).toEqual(input)
    expect(calls).toEqual([])
  })

  it('dedupes additions, ranks deterministically, and forwards reader filters', async () => {
    const observed: Array<{ readonly ref: KnowledgeRef; readonly options: unknown }> = []
    const step = expandRelations({ types: ['related'], direction: 'out', depth: 1, limit: 2 })
    const input = [hit('docs', 'guide', 'a', 0.9), hit('docs', 'guide', 'b', 0.8)]
    const result = await step.run({ hits: input }, stepContext(binding({
      neighbors: async (ref, options) => {
        observed.push({ ref, options })
        if (ref.kind !== 'chunk') return []
        if (ref.chunkId === 'a') {
          return [
            neighbor(chunkRef('guide', 'x')),
            neighbor(chunkRef('guide', 'y')),
            neighbor(chunkRef('guide', 'b')),
          ]
        }
        return [
          neighbor(chunkRef('guide', 'x')),
          neighbor(chunkRef('guide', 'z')),
        ]
      },
      hydrate: async (ref) => ref.kind === 'chunk' ? hit('docs', ref.sourceId, ref.chunkId) : null,
    })))

    expect(result.hits.map((item) => item.chunkId)).toEqual(['a', 'b', 'x', 'y'])
    expect(result.hits[2]?.score).toBeCloseTo(1 / 61 + 1 / 61)
    expect(graphOf(result.hits[2])?.seed).toBe('chunk:guide:a')
    expect(observed).toEqual([
      { ref: chunkRef('guide', 'a'), options: { types: ['related'], direction: 'out', limit: 64 } },
      { ref: chunkRef('guide', 'b'), options: { types: ['related'], direction: 'out', limit: 64 } },
    ])
  })

  it('warns when traversal ceilings are reached', async () => {
    const step = expandRelations({ depth: 2, limit: 1 })
    const result = await step.run({ hits: [hit('docs', 'guide', 'seed')] }, stepContext(binding({
      neighbors: async (ref) => {
        if (ref.kind !== 'chunk') return []
        return Array.from({ length: 64 }, (_, index) =>
          neighbor(chunkRef('guide', `${ref.chunkId}-${index}`)),
        )
      },
      hydrate: async (ref) => ref.kind === 'chunk' ? hit('docs', ref.sourceId, ref.chunkId) : null,
    })))

    expect(result.warnings).toEqual(expect.arrayContaining([
      'expandRelations truncated neighbors for chunk:guide:seed at 64.',
      'expandRelations truncated graph candidates at 512.',
    ]))
  })
})

function createEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'expand-relations-test',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => {
      const text = input.type === 'text' ? input.text.toLowerCase() : ''
      if (text.includes('intro') || text.includes('public a')) return [1, 0]
      if (text.includes('public')) return [0.9, 0.1]
      return [0, 1]
    }),
  })
}

function stepContext(knowledge?: RetrievalKnowledgeBinding): RetrievalStepContext {
  return {
    recipeId: 'recipe',
    sources: [{ retrieverId: 'docs', namespace: 'docs' }],
    originalQuery: 'query',
    request: { query: 'query' },
    concurrency: 4,
    ...(knowledge ? { knowledge } : {}),
  }
}

function binding(config: {
  readonly neighbors: RetrievalKnowledgeBinding['reader']['neighbors']
  readonly hydrate: RetrievalKnowledgeBinding['hydrate']
}): RetrievalKnowledgeBinding {
  return {
    namespace: 'docs',
    reader: { neighbors: config.neighbors },
    hydrate: config.hydrate,
  }
}

function graphOf(hit: RetrieverHit | undefined) {
  return (hit?.provenance as { readonly graph?: unknown } | undefined)?.graph
}

function neighbor(ref: KnowledgeRef): KnowledgeNeighbor {
  return { ref, type: 'related', direction: 'out' }
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function hit(namespace: string, sourceId: string, chunkId: string, score = 0): RetrieverHit {
  return {
    namespace,
    source: { id: sourceId },
    chunkId,
    content: chunkId,
    metadata: {},
    score,
  }
}

function chunk(input: {
  readonly chunkId: string
  readonly ordinal: number
  readonly content: string
  readonly parentId?: string
  readonly metadata?: Record<string, unknown>
}): CruxChunk {
  return {
    namespace: 'docs',
    sourceId: 'guide',
    chunkId: input.chunkId,
    ordinal: input.ordinal,
    content: input.content,
    metadata: input.metadata ?? {},
    ...(input.parentId ? { parent: { parentId: input.parentId } } : {}),
  }
}
