import { afterEach, describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'

const privateContent = 'private chunk text 7f64f'
const privateVersion = 'private-model-revision-93e2'

describe('embedding-stage observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('emits both embedding-stage and provider-call evidence on a miss', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const docs = setup()

    await docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-a', content: privateContent }])
    await observe.flush()

    const stageStart = transport.records.find(
      (record) => record.type === 'span:start' && record.name === 'embedding:dense-test',
    )
    const stageEnd = transport.records.find(
      (record) => record.type === 'span:end' && record.spanId === stageStart?.spanId,
    )
    expect(stageStart).toMatchObject({
      primitive: 'indexing.pipeline',
      attributes: { embeddingKind: 'dense', stageKind: 'embedding' },
    })
    expect(stageEnd).toMatchObject({
      attributes: { embeddingKind: 'dense', cache: 'miss', chunkCount: 1 },
    })
    expect(
      transport.records.some(
        (record) => record.type === 'span:start' && record.primitive === 'embedding.call',
      ),
    ).toBe(true)
    expect(stageArtifact(transport.records)).toMatchObject({
      attributes: { embeddingKind: 'dense', cache: 'miss', chunkCount: 1 },
      preview: {
        operation: 'stage',
        stages: [expect.objectContaining({ embeddingKind: 'dense', cache: 'miss' })],
      },
    })
  })

  it('emits privacy-safe stage evidence without provider-call evidence on a full hit', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const docs = setup()
    const input = [{ namespace: 'kb', sourceId: 'source-a', content: privateContent }]
    await docs.indexDocuments(input)
    await observe.flush()
    transport.clear()

    await docs.indexDocuments(input)
    await observe.flush()

    const stageStart = transport.records.find(
      (record) => record.type === 'span:start' && record.name === 'embedding:dense-test',
    )
    const stageEnd = transport.records.find(
      (record) => record.type === 'span:end' && record.spanId === stageStart?.spanId,
    )
    expect(stageEnd).toMatchObject({
      attributes: { embeddingKind: 'dense', cache: 'hit', chunkCount: 1 },
    })
    expect(
      transport.records.some(
        (record) => record.type === 'span:start' && record.primitive === 'embedding.call',
      ),
    ).toBe(false)
    expect(stageArtifact(transport.records)).toMatchObject({
      attributes: { embeddingKind: 'dense', cache: 'hit' },
    })

    const serialized = JSON.stringify(transport.records)
    expect(serialized).not.toContain(privateContent)
    expect(serialized).not.toContain(privateVersion)
    expect(serialized).not.toContain('73191')
    expect(serialized).not.toContain('28463')
  })
})

function setup() {
  return indexer({
    id: 'docs',
    namespace: 'kb',
    records: inMemoryRecordStore(),
    vectors: inMemoryVectorStore(),
    dense: embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version: privateVersion,
      embed: async (texts) => texts.map(() => [73191, 28463]),
    }),
    cache: true,
  })
}

function stageArtifact(records: ReturnType<typeof createInMemoryObservabilityTransport>['records']) {
  return records.find(
    (record) =>
      record.type === 'artifact' &&
      record.kind === 'indexing.report' &&
      record.attributes?.stageKind === 'embedding',
  )
}
