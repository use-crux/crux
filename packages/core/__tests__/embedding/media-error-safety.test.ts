import { afterEach, describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

describe('multimodal embedding error safety', () => {
  afterEach(() => resetObservabilityRuntime())

  it('rethrows provider errors unchanged without persisting media locators or payloads', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const providerError = new Error([
      'data:image/png;base64,c2VjcmV0LWltYWdl',
      'https://cdn.example/dog.png?signature=signed-secret',
      'provider-file-id-secret',
      'private-dog-filename.png',
    ].join(' '))
    const dense = embedding({
      kind: 'dense',
      name: 'hostile-media-provider',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['image'],
      batch: { maxSize: 1 },
      embed: async () => {
        throw providerError
      },
    })

    await expect(observe.run(
      { name: 'embed private image', rootPrimitive: 'embedding.call' },
      () => dense.embed({
        type: 'image',
        source: new Uint8Array([115, 101, 99, 114, 101, 116]),
        mediaType: 'image/png',
      }),
    )).rejects.toBe(providerError)
    await observe.flush()

    const records = JSON.stringify(transport.records)
    expect(records).toContain('Embedding provider call failed for media input.')
    expect(records).not.toMatch(/c2VjcmV0|signed-secret|provider-file-id-secret|private-dog-filename/)
  })

  it('rethrows primitive provider failures unchanged while projecting safe evidence', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const providerFailure = 'data:image/png;base64,cHJpdmF0ZQ==?signature=primitive-secret'
    const dense = embedding({
      kind: 'dense',
      name: 'primitive-media-provider',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['image'],
      batch: { maxSize: 1 },
      embed: async () => Promise.reject(providerFailure),
    })

    await expect(observe.run(
      { name: 'embed primitive failure', rootPrimitive: 'embedding.call' },
      () => dense.embed({
        type: 'image',
        source: new Uint8Array([1]),
        mediaType: 'image/png',
      }),
    )).rejects.toBe(providerFailure)
    await observe.flush()

    const records = JSON.stringify(transport.records)
    expect(records).toContain('Embedding provider call failed for media input.')
    expect(records).not.toMatch(/cHJpdmF0ZQ|primitive-secret/)
  })

  it('fails closed when concurrent primitive provider failures saturate projection capacity', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let failureId = 0
    const dense = embedding({
      kind: 'dense',
      name: 'saturated-media-provider',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['image'],
      batch: { maxSize: 1 },
      embed: async () => Promise.reject(`overflow-secret-${failureId++}`),
    })
    const input = {
      type: 'image' as const,
      source: new Uint8Array([1]),
      mediaType: 'image/png',
    }

    const results = await observe.run(
      { name: 'saturate primitive projections', rootPrimitive: 'embedding.call' },
      () => Promise.allSettled(Array.from({ length: 270 }, () => dense.embed(input))),
    )
    await observe.flush()

    expect(results).toHaveLength(270)
    expect(results.every((result) =>
      result.status === 'rejected' && String(result.reason).startsWith('overflow-secret-')),
    ).toBe(true)
    const records = JSON.stringify(transport.records)
    expect(records).toContain('Operation failed with redacted details.')
    expect(records).not.toContain('overflow-secret-')
  })
})
