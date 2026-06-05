import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prompt as makePrompt } from '@crux/core'
import { fallback, isFallback } from '@crux/core'
import { router } from '@crux/core/routing'
import type { FallbackMeta } from '@crux/core'
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

import { generateObject, generateText } from 'ai'
import { generate } from '../index'

// Create mock LanguageModel objects
function mockModel(id: string, provider = 'test'): any {
  return {
    provider,
    modelId: id,
    specificationVersion: 'v1',
    defaultObjectGenerationMode: 'json',
  }
}

// Create a successful generateText response
function successResponse(text: string, modelId?: string) {
  return {
    text,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
    response: { id: 'resp-1', modelId },
    providerMetadata: {},
  }
}

function successObjectResponse(object: unknown, modelId?: string) {
  return {
    object,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
    response: { id: 'resp-1', modelId },
    providerMetadata: {},
  }
}

const textPrompt = makePrompt({
  id: 'test-text',
  system: 'You are a helper.',
  prompt: 'Hello.',
})

const structuredPrompt = makePrompt({
  id: 'test-structured',
  system: 'You are a helper.',
  prompt: 'Hello.',
  output: z.object({ answer: z.string() }),
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('generate() with fallback', () => {
  it('rejects provider calls that never settle after timeout', async () => {
    vi.useFakeTimers()
    ;(generateObject as any).mockImplementationOnce(() => new Promise(() => {}))

    const promise = generate(structuredPrompt, {
      model: mockModel('hung-model'),
      timeoutMs: 50,
    } as any)
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Fallback attempt timed out',
    })

    await vi.advanceTimersByTimeAsync(50)

    await assertion
    expect((generateObject as any).mock.calls[0][0].abortSignal.aborted).toBe(true)
  })

  it('rejects routed text provider calls that never settle after timeout', async () => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined
    ;(generateText as any).mockImplementationOnce((args: { abortSignal?: AbortSignal }) => {
      receivedSignal = args.abortSignal
      return new Promise(() => {})
    })

    const routed = router({
      classify: () => 'default',
      routes: { default: mockModel('routed-model') },
    })

    const promise = generate(textPrompt, {
      model: routed as any,
      timeoutMs: 50,
    } as any)
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Fallback attempt timed out',
    })

    await vi.advanceTimersByTimeAsync(50)

    await assertion
    expect(receivedSignal?.aborted).toBe(true)
  })

  it('uses first model when it succeeds (no fallback needed)', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    ;(generateText as any).mockResolvedValueOnce(successResponse('from A', 'model-a'))

    const result = await generate(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result.text).toBe('from A')
    expect(generateText).toHaveBeenCalledTimes(1)
    // Should have been called with model-a
    expect((generateText as any).mock.calls[0][0].model).toBe(modelA)
  })

  it('falls back to second model on rate_limit (HTTP 429)', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const rateLimitError = Object.assign(new Error('Rate limited'), {
      status: 429,
    })
    ;(generateText as any)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successResponse('from B', 'model-b'))

    const result = await generate(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result.text).toBe('from B')
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('falls back to second model on server_error (HTTP 500)', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const serverError = Object.assign(new Error('Server error'), {
      status: 500,
    })
    ;(generateText as any)
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(successResponse('from B', 'model-b'))

    const result = await generate(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result.text).toBe('from B')
  })

  it('does NOT fall back on validation errors (HTTP 400)', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const validationError = Object.assign(new Error('Bad Request'), {
      status: 400,
    })
    ;(generateText as any).mockRejectedValueOnce(validationError)

    await expect(generate(textPrompt, { model: fallback(modelA, modelB) as any })).rejects.toThrow('Bad Request')

    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('throws AggregateError when all models fail', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const err1 = Object.assign(new Error('Rate limited'), { status: 429 })
    const err2 = Object.assign(new Error('Server down'), { status: 503 })

    ;(generateText as any).mockRejectedValueOnce(err1).mockRejectedValueOnce(err2)

    try {
      await generate(textPrompt, { model: fallback(modelA, modelB) as any })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      const aggErr = error as AggregateError
      expect(aggErr.errors).toHaveLength(2)
      expect(aggErr.message).toContain('2')
    }
  })

  it('attaches _meta.fallback when fallback occurs', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const rateLimitError = Object.assign(new Error('Rate limited'), {
      status: 429,
    })
    ;(generateText as any)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successResponse('from B', 'model-b'))

    const result: any = await generate(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result._meta.fallback).toBeDefined()
    const fb: FallbackMeta = result._meta.fallback
    expect(fb.attempts).toBe(2)
    expect(fb.failedModels).toEqual(['model-a'])
    expect(fb.details).toHaveLength(2)
    expect(fb.details[0].status).toBe('error')
    expect(fb.details[0].model).toBe('model-a')
    expect(fb.details[1].status).toBe('success')
    expect(fb.details[1].model).toBe('model-b')
  })

  it('does NOT attach _meta.fallback when first model succeeds', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    ;(generateText as any).mockResolvedValueOnce(successResponse('from A', 'model-a'))

    const result: any = await generate(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    // No fallback occurred — only 1 attempt, no failures
    expect(result._meta.fallback).toBeUndefined()
  })

  it('respects `on` filter — only specified categories trigger fallback', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    // Server error should NOT trigger fallback when on: ['rate_limit']
    const serverError = Object.assign(new Error('Server error'), {
      status: 500,
    })
    ;(generateText as any).mockRejectedValueOnce(serverError)

    await expect(
      generate(textPrompt, {
        model: fallback(modelA, modelB, { on: ['rate_limit'] }) as any,
      }),
    ).rejects.toThrow('Server error')

    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('falls back through 3 models to the third', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')
    const modelC = mockModel('model-c')

    ;(generateText as any)
      .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }))
      .mockResolvedValueOnce(successResponse('from C', 'model-c'))

    const result: any = await generate(textPrompt, {
      model: fallback(modelA, modelB, modelC) as any,
    })

    expect(result.text).toBe('from C')
    expect(result._meta.fallback.attempts).toBe(3)
    expect(result._meta.fallback.failedModels).toEqual(['model-a', 'model-b'])
  })

  it('works with structured output (generateObject)', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const rateLimitError = Object.assign(new Error('Rate limited'), {
      status: 429,
    })
    ;(generateObject as any)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successObjectResponse({ answer: 'hello' }, 'model-b'))

    const result: any = await generate(structuredPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    expect(result.object).toEqual({ answer: 'hello' })
    expect(generateObject).toHaveBeenCalledTimes(2)
  })

  it('uses custom shouldFallback predicate (overrides on)', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    // HTTP 400 normally doesn't trigger fallback, but our predicate says yes
    const err = Object.assign(new Error('Content filtered'), {
      status: 400,
      code: 'content_filter',
    })
    ;(generateText as any).mockRejectedValueOnce(err).mockResolvedValueOnce(successResponse('from B', 'model-b'))

    const result: any = await generate(textPrompt, {
      model: fallback(modelA, modelB, {
        shouldFallback: (e: any) => e.code === 'content_filter',
      }) as any,
    })

    expect(result.text).toBe('from B')
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('aggregates cost across all attempts in _meta.cost', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')

    const rateLimitError = Object.assign(new Error('Rate limited'), {
      status: 429,
    })
    ;(generateText as any).mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
      text: 'from B',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      response: { id: 'resp-1', modelId: 'model-b' },
      providerMetadata: { openrouter: { usage: { cost: 0.003 } } },
    })

    const result: any = await generate(textPrompt, {
      model: fallback(modelA, modelB) as any,
    })

    // The successful attempt has cost
    expect(result._meta.cost).toBe(0.003)
    // Fallback details have per-attempt cost
    expect(result._meta.fallback.details[0].cost).toBeUndefined() // failed attempt, no cost
    expect(result._meta.fallback.details[1].cost).toBe(0.003)
  })

  it('calls onAttemptError callback for each failed attempt', async () => {
    const modelA = mockModel('model-a')
    const modelB = mockModel('model-b')
    const onAttemptError = vi.fn()

    const err = Object.assign(new Error('Rate limited'), { status: 429 })
    ;(generateText as any).mockRejectedValueOnce(err).mockResolvedValueOnce(successResponse('from B', 'model-b'))

    await generate(textPrompt, {
      model: fallback(modelA, modelB, { onAttemptError }) as any,
    })

    expect(onAttemptError).toHaveBeenCalledTimes(1)
    expect(onAttemptError).toHaveBeenCalledWith(err, 1, modelA)
  })
})
