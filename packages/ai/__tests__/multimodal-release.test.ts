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
})
