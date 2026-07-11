import { describe, expect, it } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { prompt as makePrompt } from '@use-crux/core'
import { classifyProviderHttpError, CruxAdapterError, isCruxAdapterError } from '@use-crux/core/adapter'
import { describeNormalizedOutcomeConformance, standardHttpErrorCases } from '@use-crux/core/adapter/testing'
import { createGoogle } from '../src'
import { mapGoogleFinishReason } from '../src/response'
import { createGoogleStreamCapture } from '../src/stream'

const textPrompt = makePrompt({ id: 'google-normalized', prompt: 'Hi' })

describeNormalizedOutcomeConformance({
  name: 'google',
  mapFinishReason: (raw: string) => mapGoogleFinishReason(raw),
  finishReasonCases: [
    { label: 'STOP', raw: 'STOP', expected: 'stop' },
    { label: 'MAX_TOKENS', raw: 'MAX_TOKENS', expected: 'length' },
    { label: 'FUNCTION_CALL', raw: 'FUNCTION_CALL', expected: 'tool-calls' },
    { label: 'SAFETY', raw: 'SAFETY', expected: 'content-filter' },
  ],
  unrecognizedFinishReason: 'OTHER',
  modelSideBlocking: true,
  mapError: (error) => classifyProviderHttpError(error, 'google'),
  errorCases: standardHttpErrorCases(),
  unrecognizedError: new Error('mystery'),
})

describe('GoogleChatStream (unit)', () => {
  it('assembles completed function calls only, keyed by id', async () => {
    async function* chunks(): AsyncIterable<GenerateContentResponse> {
      yield { candidates: [{ content: { role: 'model', parts: [{ text: 'he' }] } }] } as GenerateContentResponse
      yield {
        modelVersion: 'gemini-actual',
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { id: 'call_1', name: 'lookup', args: { q: 'x' } } }],
            },
            finishReason: 'FUNCTION_CALL',
          },
        ],
      } as unknown as GenerateContentResponse
    }

    const captured = createGoogleStreamCapture(chunks())
    for await (const _ of captured) void _

    const meta = captured.finalMeta()
    expect(meta.finishReason).toBe('tool-calls')
    expect(meta.actualModelId).toBe('gemini-actual')
    expect(meta.usage?.totalTokens).toBe(7)
    expect(meta.toolCalls).toEqual([{ id: 'call_1', name: 'lookup', args: { q: 'x' } }])
  })
})

describe('Google normalized finish reasons (generate)', () => {
  const cases: Array<[string, string]> = [
    ['STOP', 'stop'],
    ['MAX_TOKENS', 'length'],
    ['SAFETY', 'content-filter'],
    ['RECITATION', 'content-filter'],
    ['BLOCKLIST', 'content-filter'],
    ['PROHIBITED_CONTENT', 'content-filter'],
    ['SPII', 'content-filter'],
    ['FUNCTION_CALL', 'tool-calls'],
    ['TOOL_CALL', 'tool-calls'],
    ['MALFORMED_FUNCTION_CALL', 'error'],
    ['OTHER', 'unknown'],
  ]
  for (const [raw, expected] of cases) {
    it(`maps finishReason "${raw}" to "${expected}"`, async () => {
      const adapter = createGoogle(generateClient({ finishReason: raw }), { cachedContent: false })
      const result = await adapter.generate(textPrompt, { model: 'gemini' })
      expect(result.finalStep.finishReason).toBe(expected)
    })
  }

  it('folds promptFeedback.blockReason into content-filter regardless of finishReason', async () => {
    const adapter = createGoogle(
      generateClient({ finishReason: undefined, blockReason: 'SAFETY' }),
      { cachedContent: false },
    )
    const result = await adapter.generate(textPrompt, { model: 'gemini' })
    expect(result.finalStep.finishReason).toBe('content-filter')
  })
})

describe('Google stream completion metadata (previously dropped)', () => {
  it('normalizes finishReason/usage/model on stream completion', async () => {
    const client = streamingClient({
      chunks: ['he', 'llo'],
      finishReason: 'STOP',
      usage: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
      model: 'gemini-actual',
      toolCall: { id: 'call_1', name: 'lookup', args: { q: 'x' } },
    })

    const handle = await createGoogle(client, { cachedContent: false }).stream(textPrompt, { model: 'gemini' })
    const streamed: string[] = []
    for await (const chunk of handle.textStream) streamed.push(chunk)
    expect(streamed.join('')).toBe('hello')

    const completion = await handle.completion
    expect(completion.finalStep.finishReason).toBe('stop')
    expect(completion.finalStep.usage?.totalTokens).toBe(7)
    expect(completion.finalStep.modelId).toBe('gemini-actual')
  })

  it('does not swallow an erroring stream: the completion rejects with a normalized error', async () => {
    const client = {
      models: {
        generateContentStream: async () => erroringStream(),
      },
    } as unknown as GoogleGenAI

    const handle = await createGoogle(client, { cachedContent: false }).stream(textPrompt, { model: 'gemini' })
    const drain = (async () => {
      for await (const _ of handle.textStream) void _
    })()
    await expect(drain).rejects.toBeInstanceOf(CruxAdapterError)
    await expect(handle.completion).rejects.toBeInstanceOf(CruxAdapterError)
  })
})

describe('Google normalized provider errors', () => {
  it('classifies a 429 ApiError as retryable rate-limit', async () => {
    const error = await capture(
      createGoogle(throwingClient(429), { cachedContent: false }).generate(textPrompt, { model: 'gemini' }),
    )
    expect(isCruxAdapterError(error)).toBe(true)
    expect((error as CruxAdapterError).providerError).toMatchObject({ kind: 'rate-limit', retryable: true })
  })

  it('classifies a 400 ApiError as non-retryable invalid-request', async () => {
    const error = await capture(
      createGoogle(throwingClient(400), { cachedContent: false }).generate(textPrompt, { model: 'gemini' }),
    )
    expect((error as CruxAdapterError).providerError).toMatchObject({ kind: 'invalid-request', retryable: false })
  })
})

describe('Google abort signal threading', () => {
  it('folds the caller AbortSignal into config.abortSignal without leaking across calls', async () => {
    const requests: Array<Record<string, unknown>> = []
    const client = {
      models: {
        generateContent: async (request: unknown) => {
          requests.push(request as Record<string, unknown>)
          return googleGenerateResponse({ finishReason: 'STOP' })
        },
      },
    } as unknown as GoogleGenAI
    const adapter = createGoogle(client, { cachedContent: false })

    const controller = new AbortController()
    await adapter.generate(textPrompt, { model: 'gemini', signal: controller.signal })
    await adapter.generate(textPrompt, { model: 'gemini' })

    const firstConfig = requests[0]?.config as Record<string, unknown> | undefined
    const secondConfig = requests[1]?.config as Record<string, unknown> | undefined
    expect(firstConfig?.abortSignal).toBe(controller.signal)
    expect(secondConfig?.abortSignal).toBeUndefined()
  })
})

function generateClient(opts: { finishReason: string | undefined; blockReason?: string }): GoogleGenAI {
  return {
    models: {
      generateContent: async () => googleGenerateResponse(opts),
    },
  } as unknown as GoogleGenAI
}

function googleGenerateResponse(opts: { finishReason: string | undefined; blockReason?: string }): unknown {
  return {
    text: 'hello',
    modelVersion: 'gemini-actual',
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'hello' }] },
        finishReason: opts.finishReason,
      },
    ],
    ...(opts.blockReason ? { promptFeedback: { blockReason: opts.blockReason } } : {}),
  }
}

function throwingClient(status: number): GoogleGenAI {
  return {
    models: {
      generateContent: async () => {
        const err = new Error(`google ${status}`) as Error & { status: number }
        err.name = 'ApiError'
        err.status = status
        throw err
      },
    },
  } as unknown as GoogleGenAI
}

function streamingClient(script: {
  chunks: readonly string[]
  finishReason: string
  usage: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }
  model: string
  toolCall: { id: string; name: string; args: unknown }
}): GoogleGenAI {
  async function* stream() {
    for (const text of script.chunks) {
      yield { candidates: [{ content: { role: 'model', parts: [{ text }] } }] }
    }
    yield {
      modelVersion: script.model,
      usageMetadata: script.usage,
      candidates: [
        {
          content: { role: 'model', parts: [{ functionCall: script.toolCall }] },
          finishReason: script.finishReason,
        },
      ],
    }
  }
  return {
    models: {
      generateContentStream: async () => stream(),
    },
  } as unknown as GoogleGenAI
}

function erroringStream(): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { candidates: [{ content: { role: 'model', parts: [{ text: 'partial' }] } }] }
      throw new Error('connection reset')
    },
  }
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    return error
  }
}
