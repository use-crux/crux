import { describe, expect, it } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { context, prompt as makePrompt } from '@crux/core'
import { createGoogle } from '../index'

interface GoogleFakeRequest {
  readonly model: unknown
  readonly contents?: unknown
  readonly config?: Record<string, unknown>
}

interface GoogleFake {
  readonly calls: GoogleFakeRequest[]
  readonly cacheCreates: GoogleFakeRequest[]
  readonly client: GoogleGenAI
}

describe('Google profile system cache planning', () => {
  it('uses the same cachedContent plan for generate and stream requests', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)
    const cachedRules = context({ id: 'rules', system: 'Cached rules', cache: { providerCache: true } })
    const promptRules = context({ id: 'prompt-rules', system: 'Prompt rules' })
    const cachedPrompt = makePrompt({
      id: 'google-cache-profile',
      use: [cachedRules, promptRules],
      prompt: 'Hello',
    })

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })
    await adapter.stream(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(fake.cacheCreates).toEqual([
      {
        model: 'gemini-2.5-flash',
        config: { systemInstruction: 'Cached rules', ttl: '300s' },
      },
    ])
    expect(fake.calls.map((call) => call.config)).toEqual([
      expect.objectContaining({ cachedContent: 'cachedContents/shared', systemInstruction: 'Prompt rules' }),
      expect.objectContaining({ cachedContent: 'cachedContents/shared', systemInstruction: 'Prompt rules' }),
    ])
  })
})

function createGoogleFake(): GoogleFake {
  const calls: GoogleFakeRequest[] = []
  const cacheCreates: GoogleFakeRequest[] = []
  const fake = {
    models: {
      generateContent: async (request: GoogleFakeRequest) => {
        calls.push(request)
        return googleResponse()
      },
      generateContentStream: async (request: GoogleFakeRequest) => {
        calls.push(request)
        return googleStream()
      },
    },
    caches: {
      create: async (request: GoogleFakeRequest) => {
        cacheCreates.push(request)
        return { name: 'cachedContents/shared' }
      },
      delete: async () => ({}),
      get: async () => ({ name: 'cachedContents/shared' }),
      update: async () => ({ name: 'cachedContents/shared' }),
    },
  }
  return { calls, cacheCreates, client: fake as unknown as GoogleGenAI }
}

function googleResponse(): GenerateContentResponse {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    text: 'ok',
  } as unknown as GenerateContentResponse
}

async function* googleStream(): AsyncIterable<GenerateContentResponse> {
  yield googleResponse()
}
