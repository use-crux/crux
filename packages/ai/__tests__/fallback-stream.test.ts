import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prompt as makePrompt } from '@crux/core'
import { fallback } from '@crux/core'
import { z } from 'zod'

// Mock the 'ai' module
vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamObject: vi.fn(),
  streamText: vi.fn(),
  rerank: vi.fn(),
  jsonSchema: vi.fn((s: any) => s),
  tool: vi.fn(),
  stepCountIs: vi.fn(),
  hasToolCall: vi.fn(),
}))

import { generateText, streamText } from 'ai'
import { generate, stream } from '../index'

function mockModel(id: string, provider = 'test'): any {
  return {
    provider,
    modelId: id,
    specificationVersion: 'v1',
    defaultObjectGenerationMode: 'json',
  }
}

/** Create a mock streamText result that resolves successfully */
function mockStreamResult(text: string) {
  const completionPromise = Promise.resolve({
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
  })
  return {
    textStream: (async function* () {
      yield text
    })(),
    text: Promise.resolve(text),
    _meta: { _streamCompletion: completionPromise },
  }
}

const textPrompt = makePrompt({
  id: 'test-stream',
  system: 'You are a helper.',
  prompt: 'Hello.',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stream() with fallback', () => {
  it('uses first model when it succeeds', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    ;(streamText as any).mockReturnValueOnce(mockStreamResult('from A'))

    const result = await stream(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result).toBeDefined()
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('falls back to second model on rate_limit', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const rateLimitError = Object.assign(new Error('Rate limited'), {
      status: 429,
    })
    ;(streamText as any)
      .mockImplementationOnce(() => {
        throw rateLimitError
      })
      .mockReturnValueOnce(mockStreamResult('from B'))

    const result = await stream(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result).toBeDefined()
    expect(streamText).toHaveBeenCalledTimes(2)
  })

  it('does NOT fall back on validation errors', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const validationError = Object.assign(new Error('Bad Request'), {
      status: 400,
    })
    ;(streamText as any).mockImplementationOnce(() => {
      throw validationError
    })

    await expect(stream(textPrompt, { model: fallback(modelA, modelB) as any })).rejects.toThrow('Bad Request')

    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('throws AggregateError when all models fail', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const err1 = Object.assign(new Error('Rate limited'), { status: 429 })
    const err2 = Object.assign(new Error('Server down'), { status: 503 })

    ;(streamText as any)
      .mockImplementationOnce(() => {
        throw err1
      })
      .mockImplementationOnce(() => {
        throw err2
      })

    try {
      await stream(textPrompt, { model: fallback(modelA, modelB) as any })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      const aggErr = error as AggregateError
      expect(aggErr.errors).toHaveLength(2)
    }
  })

  it('respects `on` filter for streams', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const serverError = Object.assign(new Error('Server error'), {
      status: 500,
    })
    ;(streamText as any).mockImplementationOnce(() => {
      throw serverError
    })

    await expect(
      stream(textPrompt, {
        model: fallback(modelA, modelB, { on: ['rate_limit'] }) as any,
      }),
    ).rejects.toThrow('Server error')

    expect(streamText).toHaveBeenCalledTimes(1)
  })
})

describe('generate() with per-attempt timeout', () => {
  it('times out a direct provider call and passes an abort signal', async () => {
    let receivedSignal: AbortSignal | undefined
    ;(generateText as any).mockImplementationOnce((args: { abortSignal?: AbortSignal }) => {
      receivedSignal = args.abortSignal
      return new Promise(() => {
        // Intentionally never settles; timeoutMs must close the call.
      })
    })

    await expect(
      generate(textPrompt, {
        model: mockModel('slow-model') as any,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // Core wins the timeout race and rejects first; the adapter aborts the
    // forwarded provider signal one macrotask later. Yield so that pending
    // timer callback runs before asserting the signal was aborted.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receivedSignal).toBeDefined()
    expect(receivedSignal?.aborted).toBe(true)
  })

  it('times out slow model and falls back to fast one', async () => {
    const modelA = mockModel('slow-model')
    const modelB = mockModel('fast-model')

    // Model A hangs for 500ms, model B responds instantly
    ;(generateText as any)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 200)
          }),
      )
      .mockResolvedValueOnce({
        text: 'from fast',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        response: { id: 'resp-1', modelId: 'fast-model' },
        providerMetadata: {},
      })

    const result = await generate(textPrompt, {
      model: fallback(modelA, modelB, { timeout: 100 }) as any,
    })

    expect(result.text).toBe('from fast')
  }, 5000)
})
