import { describe, expect, it, vi } from 'vitest'
import type { EmbedContentParameters, EmbedContentResponse, GoogleGenAI } from '@google/genai'
import { embedding } from '../src/embedding'

describe('Google multimodal embedding request mapping', () => {
  it('uses the documented Gemini Embedding 2 defaults on the zero-config path', async () => {
    const { client, embedContent } = fakeClient()
    const model = embedding(client, { model: 'gemini-embedding-2' })

    await model.embed('dog')

    expect(model).toMatchObject({
      name: 'gemini-embedding-2',
      dimensions: 3072,
      maxInputTokens: 8192,
      modalities: ['text', 'image', 'audio', 'video', 'document'],
    })
    expect(embedContent).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ outputDimensionality: 3072 }),
    }))
  })

  it.each([
    ['image data', { type: 'image', source: dataAsset('image/png', [1, 2, 3]) }, { inlineData: { data: 'AQID', mimeType: 'image/png' } }],
    ['image URL', { type: 'image', source: urlAsset('https://cdn.example/dog.png', 'image/png') }, { fileData: { fileUri: 'https://cdn.example/dog.png', mimeType: 'image/png' } }],
    ['audio', { type: 'audio', source: dataAsset('audio/mpeg', [4, 5]) }, { inlineData: { data: 'BAU=', mimeType: 'audio/mpeg' } }],
    ['video', { type: 'video', source: dataAsset('video/mp4', [6, 7]) }, { inlineData: { data: 'Bgc=', mimeType: 'video/mp4' } }],
    ['PDF', { type: 'document', source: dataAsset('application/pdf', [8, 9]) }, { inlineData: { data: 'CAk=', mimeType: 'application/pdf' } }],
  ] as const)('maps %s to one Google Content', async (_label, input, expectedPart) => {
    const { client, embedContent } = fakeClient()
    const model = multimodalEmbedding(client)

    await model.embed(input)

    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-2',
      contents: [{ role: 'user', parts: [expectedPart] }],
      config: {
        taskType: undefined,
        title: undefined,
        outputDimensionality: 768,
        mimeType: undefined,
        autoTruncate: undefined,
      },
    })
  })

  it('maps text and Google file assets without conflating batch items', async () => {
    const { client, embedContent } = fakeClient()
    const model = multimodalEmbedding(client)

    await model.embedMany([
      'dog',
      {
        type: 'document',
        source: {
          type: 'provider-file',
          provider: 'google',
          fileId: 'files/manual-1',
          mediaType: 'application/pdf',
        },
      },
    ])

    expect(embedContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: [
        { role: 'user', parts: [{ text: 'dog' }] },
        { role: 'user', parts: [{ fileData: { fileUri: 'files/manual-1', mimeType: 'application/pdf' } }] },
      ],
    }))
  })

  it('maps query and document roles to their configured task types', async () => {
    const { client, embedContent } = fakeClient()
    const model = embedding(client, {
      name: 'google-text',
      model: 'text-embedding-004',
      dimensions: 768,
      maxInputTokens: 2048,
      tasks: { query: 'RETRIEVAL_QUERY', document: 'RETRIEVAL_DOCUMENT' },
    })

    await model.embed('query', { role: 'query' })
    await model.embed('document', { role: 'document' })

    expect(embedContent.mock.calls.map(([request]) => request.config?.taskType)).toEqual([
      'RETRIEVAL_QUERY',
      'RETRIEVAL_DOCUMENT',
    ])
  })

  it('lets explicit modalities override a known model default', async () => {
    const { client, embedContent } = fakeClient()
    const textOnly = embedding(client, {
      name: 'explicit-text',
      model: 'gemini-embedding-2',
      dimensions: 768,
      maxInputTokens: 8192,
      modalities: ['text'],
    })

    expect(textOnly.modalities).toEqual(['text'])
    await expect(textOnly.embed({
      type: 'image',
      source: dataAsset('image/png', [1]),
    } as never)).rejects.toThrow('accepts text only')
    expect(embedContent).not.toHaveBeenCalled()
  })

  it('sequences Gemini Embedding 2 batches for Vertex clients', async () => {
    const { client, embedContent } = fakeClient(true)
    const model = multimodalEmbedding(client)

    await model.embedMany(['one', 'two'])

    expect(embedContent).toHaveBeenCalledTimes(2)
    expect(embedContent.mock.calls.map(([request]) => request.contents)).toEqual([
      [{ role: 'user', parts: [{ text: 'one' }] }],
      [{ role: 'user', parts: [{ text: 'two' }] }],
    ])
  })

  it('rejects file handles owned by another provider before Google I/O', async () => {
    const { client, embedContent } = fakeClient()
    const model = multimodalEmbedding(client)

    await expect(model.embed({
      type: 'image',
      source: {
        type: 'provider-file',
        provider: 'openai',
        fileId: 'file-wrong',
        mediaType: 'image/png',
      },
    })).rejects.toThrow(/belong to google|google provider/i)
    expect(embedContent).not.toHaveBeenCalled()
  })
})

function multimodalEmbedding(client: GoogleGenAI) {
  return embedding(client, {
    name: 'google-multimodal',
    model: 'gemini-embedding-2',
    dimensions: 768,
    maxInputTokens: 8192,
  })
}

function fakeClient(vertexai = false) {
  const embedContent = vi.fn(async (request: EmbedContentParameters) => ({
    embeddings: Array.from(
      { length: Array.isArray(request.contents) ? request.contents.length : 1 },
      () => ({ values: [1, 0], statistics: { tokenCount: 1 } }),
    ),
  }) as EmbedContentResponse)
  return {
    client: { vertexai, models: { embedContent } } as unknown as GoogleGenAI,
    embedContent,
  }
}

function dataAsset(mediaType: string, bytes: readonly number[]) {
  return { type: 'data' as const, data: new Uint8Array(bytes), mediaType }
}

function urlAsset(url: string, mediaType: string) {
  return { type: 'url' as const, url: new URL(url), mediaType }
}
