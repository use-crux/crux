import { describe, expect, it, vi } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { prompt as makePrompt } from '@use-crux/core'
import { z } from 'zod'
import { createGoogle, googleProviderRuntime } from '../src'

interface GoogleRuntimeRequest {
  readonly model: unknown
  readonly contents?: unknown
  readonly config?: Record<string, unknown>
}

function googleResponse(text: string): GenerateContentResponse {
  return {
    candidates: [
      {
        content: { role: 'model', parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 4,
      candidatesTokenCount: 3,
      totalTokenCount: 7,
    },
    text,
  } as unknown as GenerateContentResponse
}

describe('Google provider runtime', () => {
  it('exposes Google as a single-turn provider runtime peer', async () => {
    const generateContent = vi.fn(async (_request: GoogleRuntimeRequest) =>
      googleResponse('provider runtime response'),
    )
    const client = {
      models: {
        generateContent,
        generateContentStream: vi.fn(),
      },
    } as unknown as GoogleGenAI
    const adapter = googleProviderRuntime.create(client, {})

    const result = await adapter.generate(makePrompt({ id: 'google-provider-runtime' }), {
      model: 'gemini-2.5-flash',
    })

    expect(googleProviderRuntime.id).toBe('google')
    expect(adapter.providerId).toBe('google')
    expect(result.text).toBe('provider runtime response')
    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('exposes retrieval model and judge-backed reranker on created adapters', async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(googleResponse('retrieval text'))
      .mockResolvedValueOnce(googleResponse(JSON.stringify({ answer: 'retrieval object' })))
      .mockResolvedValueOnce(googleResponse(JSON.stringify({ rankings: [{ index: 1, score: 0.88 }] })))
    const client = {
      models: {
        generateContent,
        generateContentStream: vi.fn(),
      },
    } as unknown as GoogleGenAI
    const adapter = createGoogle(client, { cachedContent: false })

    const retrieval = adapter.retrievalModel({ model: 'gemini-2.5-flash' })
    await expect(retrieval.generateText({ prompt: 'retrieve text' })).resolves.toEqual({ text: 'retrieval text' })
    await expect(
      retrieval.generateObject({
        prompt: 'retrieve object',
        schema: z.object({ answer: z.string() }),
      }),
    ).resolves.toEqual({ object: { answer: 'retrieval object' } })

    await expect(
      adapter.reranker({ model: 'gemini-2.5-flash' }).rerank({
        query: 'needle',
        hits: [
          { namespace: 'n', source: { id: 'a' }, chunkId: 'a1', content: 'first', metadata: {}, score: 0.1 },
          { namespace: 'n', source: { id: 'b' }, chunkId: 'b1', content: 'second', metadata: {}, score: 0.2 },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ source: { id: 'b' }, score: 0.88, provenance: { rerankScore: 0.88 } }),
      expect.objectContaining({ source: { id: 'a' }, score: 0.1 }),
    ])
  })
})
