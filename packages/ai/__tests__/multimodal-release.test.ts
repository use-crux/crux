import type { ImageModel, LanguageModel } from 'ai'
import { prompt } from '@use-crux/core'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { inMemoryAssetStore, type AssetStore } from '@use-crux/core/storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCruxAi } from '../src'
import { scriptedGateway } from './scripted-gateway'

describe('multimodal release tracer', () => {
  afterEach(() => resetObservabilityRuntime())

  it('traces generate and stream with an AI SDK model object verbatim', async () => {
    const chat = prompt({ id: 'model-id-trace', prompt: 'Hello.' })
    const scripted = scriptedGateway({
      generateText: [{ text: 'generated' }],
      streamText: [{ chunks: ['streamed'] }],
    })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const ai = createCruxAi({ gateway: scripted.gateway })
    const model = {
      provider: 'openrouter',
      modelId: 'openai/gpt-5.6-luna',
      specificationVersion: 'v3',
    } as unknown as LanguageModel

    await ai.generate(chat, { model })
    const streamed = await ai.stream(chat, { model })
    await streamed.completion
    await observe.flush()

    const generationStarts = transport.records.filter(
      (record) =>
        record.type === 'span:start' &&
        (record.primitive === 'generation.call' ||
          record.primitive === 'generation.stream'),
    )
    expect(generationStarts).toHaveLength(2)
    expect(generationStarts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.objectContaining({ operation: 'generate' }),
        }),
        expect.objectContaining({
          attributes: expect.objectContaining({ operation: 'stream' }),
        }),
      ]),
    )
    for (const record of generationStarts) {
      expect(record).toMatchObject({
        attributes: {
          provider: 'openrouter',
          model: 'openai/gpt-5.6-luna',
        },
      })
    }
  })

  it('omits an empty AI SDK modelId from trace metadata', async () => {
    const chat = prompt({ id: 'empty-model-id-trace', prompt: 'Hello.' })
    const scripted = scriptedGateway({ generateText: [{ text: 'generated' }] })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const ai = createCruxAi({ gateway: scripted.gateway })
    const model = {
      provider: 'openrouter',
      modelId: '',
      specificationVersion: 'v3',
    } as unknown as LanguageModel

    await ai.generate(chat, { model })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(generationStart).toMatchObject({
      attributes: { provider: 'openrouter' },
    })
    expect(generationStart?.attributes).not.toHaveProperty('model')
  })

  it('round-trips explicitly stored media through generate and stream without unsafe capture', async () => {
    const store = inMemoryAssetStore()
    const stored = await store.put({
      type: 'data', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', filename: 'private.png',
    })
    const image = await store.get(stored.ref)
    const chat = prompt({
      messages: () => [{
        role: 'user',
        content: [{ type: 'text', text: 'Describe this.' }, { type: 'image', source: image, mediaType: 'image/png' }],
      }],
    })
    const scripted = scriptedGateway({ generateText: [{ text: 'generated' }], streamText: [{ chunks: ['streamed'] }] })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const ai = createCruxAi({ gateway: scripted.gateway })
    const languageModel = { provider: 'openai', modelId: 'gpt-4o', specificationVersion: 'v3' } as unknown as LanguageModel

    await expect(ai.generate(chat, { model: languageModel })).resolves.toMatchObject({ text: 'generated' })
    const streamed = await ai.stream(chat, { model: languageModel })
    await expect(streamed.completion).resolves.toMatchObject({ text: 'streamed' })
    await observe.flush()

    expect(scripted.calls.generateText[0]?.messages).toMatchObject([{
      content: [{ type: 'text' }, { type: 'image', image: expect.any(Uint8Array), mediaType: 'image/png' }],
    }])
    expect(scripted.calls.streamText[0]?.messages).toMatchObject([{
      content: [{ type: 'text' }, { type: 'image', image: expect.any(Uint8Array), mediaType: 'image/png' }],
    }])
    expect(transport.records.length).toBeGreaterThan(0)
    expect(JSON.stringify(transport.records)).not.toMatch(/private\.png|asset:\/\/|1,2,3/)
  })

  it('does not regenerate an image when explicit persistence fails', async () => {
    const file = { base64: 'AQI=', uint8Array: new Uint8Array([1, 2]), mediaType: 'image/png' }
    const scripted = scriptedGateway({ generateImage: [{
      image: file, images: [file], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }] })
    const ai = createCruxAi({ gateway: scripted.gateway })
    const persistenceError = new Error('storage unavailable')
    const failingStore: AssetStore = {
      put: vi.fn(async () => Promise.reject(persistenceError)),
      get: vi.fn(),
      delete: vi.fn(),
    }

    const result = await ai.generateImage({ model: {} as ImageModel, prompt: 'A quiet canal' })
    await expect(failingStore.put(result.image)).rejects.toBe(persistenceError)
    expect(scripted.calls.generateImage).toHaveLength(1)
  })

  it('carries every normal-message media modality and ordered mixed output through one framework call', async () => {
    const messages = prompt({ messages: () => [{ role: 'user' as const, content: [
      { type: 'image' as const, source: new Uint8Array([1]), mediaType: 'image/png' },
      { type: 'audio' as const, source: new Uint8Array([2]), mediaType: 'audio/wav' },
      { type: 'video' as const, source: new Uint8Array([3]), mediaType: 'video/mp4' },
      { type: 'file' as const, source: new Uint8Array([4]), mediaType: 'application/pdf' },
    ] }] })
    const scripted = scriptedGateway({ generateText: [{
      text: 'summary',
      content: [
        { type: 'reasoning', text: 'checked all inputs' },
        { type: 'text', text: 'summary' },
        { type: 'file', data: new Uint8Array([9]), mediaType: 'image/png' },
      ],
    }] })
    const ai = createCruxAi({ gateway: scripted.gateway })
    const model = { provider: 'custom', modelId: 'multimodal', specificationVersion: 'v3' } as unknown as LanguageModel

    const result = await ai.generate(messages, { model })

    expect(scripted.calls.generateText).toHaveLength(1)
    expect(scripted.calls.generateText[0]?.messages).toMatchObject([{ content: [
      { type: 'image', image: expect.any(Uint8Array) },
      { type: 'file', data: expect.any(Uint8Array), mediaType: 'audio/wav' },
      { type: 'file', data: expect.any(Uint8Array), mediaType: 'video/mp4' },
      { type: 'file', data: expect.any(Uint8Array), mediaType: 'application/pdf' },
    ] }])
    expect(result.content).toMatchObject([
      { type: 'reasoning', text: 'checked all inputs' },
      { type: 'text', text: 'summary' },
      { type: 'image', source: expect.any(Uint8Array) },
    ])
  })
})
