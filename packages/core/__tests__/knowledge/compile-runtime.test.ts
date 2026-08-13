import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import { indexingPipeline, type CruxChunk } from '../../src/indexing'
import { relate } from '../../src/knowledge/relate/relate'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { expandRelations, knowledgeBase, retrieve } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

describe('knowledgeBase connected knowledge compile path', () => {
  it('runs derive and compile from index() and expands graph-provenance hits', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({
      id: 'kb',
      storage,
      embeddings: topicEmbedding(),
      pipeline: indexingPipeline({
        derive: [relate({
          id: 'runtime-refs',
          version: 1,
          types: { mentions: relation(['chunk'], ['chunk'], 'directed') },
          run: (input, api) => {
            if (input.document.sourceId !== 'alpha') return
            const from = chunkRef('alpha', 'a1')
            api.emit('mentions', from, chunkRef('beta', 'b1'), { evidence: from, provenance: 'exact' })
          },
        })],
      }),
      lifecycle: { retention: 'retain-inactive' },
    })

    await docs.index([chunk('alpha', 'a1', 'alpha seed'), chunk('beta', 'b1', 'beta neighbor')])
    const recipe = docs.recipe({
      id: 'expand-runtime',
      steps: [retrieve({ limit: 1 }), expandRelations({ types: ['mentions'], direction: 'out', seeds: ['hits'] })],
    })
    const hits = await recipe.retrieve('alpha')

    expect(hits.map((hit) => hit.source.id)).toEqual(['alpha', 'beta'])
    expect(hits[1]?.provenance).toMatchObject({
      graph: {
        seed: 'chunk:alpha:a1',
        path: ['chunk:alpha:a1', 'chunk:beta:b1'],
        edges: ['mentions'],
        distance: 1,
      },
    })
  })

  it('does not write claim records for a plain knowledge base', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({ id: 'plain', storage, embeddings: topicEmbedding() })

    await docs.index([{ ...chunk('plain-source', 'p1', 'plain content'), namespace: 'plain' }])

    const keys = (await storage.records.list('')).entries.map((entry) => entry.key)
    expect(keys.filter((key) => key.includes(':claims:'))).toEqual([])
  })
})

function relation(
  from: readonly ['chunk'],
  to: readonly ['chunk'],
  direction: 'directed',
) {
  return { from, to, direction, description: `${direction} relation` }
}

function chunk(sourceId: string, chunkId: string, content: string): CruxChunk {
  return schema2TextChunk({ namespace: 'kb', sourceId, chunkId, ordinal: 0, content, metadata: {} })
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function topicEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'topic',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => textOf(input).includes('alpha') ? [1, 0] : [0, 1]),
  })
}
