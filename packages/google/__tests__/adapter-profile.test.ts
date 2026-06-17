import { describe, expect, it, vi } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { prompt as makePrompt } from '@crux/core'
import { googleProfile } from '../index'

interface GoogleProfileRequest {
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

describe('Google adapter profile', () => {
  it('creates the public adapter runtime from the profile with profile dependencies', async () => {
    const generateContent = vi.fn(async (_request: GoogleProfileRequest) => googleResponse('profile response'))
    const client = {
      models: {
        generateContent,
        generateContentStream: vi.fn(),
      },
    } as unknown as GoogleGenAI
    const adapter = googleProfile.create(client, {})

    const result = await adapter.generate(makePrompt({ id: 'google-profile' }), {
      model: 'gemini-2.5-flash',
    })

    expect(googleProfile.id).toBe('google')
    expect(adapter.providerId).toBe('google')
    expect(result.text).toBe('profile response')
    expect(generateContent).toHaveBeenCalledOnce()
  })
})
