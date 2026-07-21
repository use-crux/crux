import { afterEach, describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { knowledgeBase } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'

describe('knowledge-base contributor evidence', () => {
  afterEach(() => resetObservabilityRuntime())

  it('attaches the authored knowledge-base ref to its retrieval owner span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: embedding({
        kind: 'dense',
        name: 'fixture',
        dimensions: 2,
        maxInputTokens: 20,
        batch: { maxSize: 4 },
        embed: async (inputs) => inputs.map(() => [1, 0]),
      }),
    })
    await docs.index([{ namespace: 'docs', sourceId: 'one', content: 'One' }])
    await docs.retriever().retrieve('one')
    await observe.flush()

    const span = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'retrieval.query',
    )
    expect(span).toMatchObject({
      definitionRefs: [
        { id: 'rag.retriever:docs', kind: 'rag.retriever', role: 'invoked-retriever' },
        { id: 'rag.knowledgeBase:docs', kind: 'rag.knowledgeBase', role: 'contributed-knowledge-base' },
      ],
    })
  })
})
