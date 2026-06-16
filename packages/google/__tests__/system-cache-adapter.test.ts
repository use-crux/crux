import { describe, expect, it } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import type { Message, SystemBlock } from '@crux/core'
import type { CallArgs } from '@crux/core/adapter'
import { GoogleCacheManager } from '../cache-manager'
import { CACHE_DEFAULTS } from '../cache-types'
import { buildGoogleSpec } from '../index'
import type { GoogleExtra } from '../index'

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

describe('Google AdapterSpec system cache planning', () => {
  it('uses the same cachedContent plan for call and stream requests', async () => {
    const fake = createGoogleFake()
    const spec = buildGoogleSpec(new GoogleCacheManager(fake.client, CACHE_DEFAULTS))
    const args = callArgs({
      system: 'Cached rules\n\nPrompt rules',
      systemBlocks: [
        { source: 'context:rules', text: 'Cached rules', providerCache: true },
        { source: 'prompt', text: 'Prompt rules', providerCache: false },
      ],
    })

    await spec.call(fake.client, args)
    await spec.stream(fake.client, args)

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

const BASE_MESSAGES: readonly Message[] = [{ role: 'user', content: 'Hello' }]

function callArgs(overrides: Partial<CallArgs<GoogleExtra>> = {}): CallArgs<GoogleExtra> {
  return {
    model: 'gemini-2.5-flash',
    system: 'System.',
    systemBlocks: undefined,
    messages: [...BASE_MESSAGES],
    settings: {},
    schema: undefined,
    schemaParams: undefined,
    tools: undefined,
    extra: {},
    ...overrides,
  }
}

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
