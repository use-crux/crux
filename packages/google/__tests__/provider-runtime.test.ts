import { describe, expect, it, vi } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { prompt as makePrompt } from '@use-crux/core'
import { googleProviderRuntime } from '../index'

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
})
