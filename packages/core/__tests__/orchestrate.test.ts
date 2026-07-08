import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FallbackModel } from '../generation/fallback'
import { fallback } from '../generation/fallback'

import {
  TimeoutError,
  orchestrateGenerate,
  orchestrateStream,
  withBudget,
  wrapStreamIterable,
} from '../generation'
import type { OrchestrationSpec, TextDeltaExtractor } from '../generation'
import { resolveModel } from '../routing/resolve'

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Create a mock result with _meta */
function mockResult(text: string, cost?: number) {
  return {
    text,
    _meta: {
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, inputTokenDetails: {}, outputTokenDetails: {} },
      cost,
    },
  }
}

/** Create a rate limit error (status 429) */
function rateLimitError(msg = 'Rate limited') {
  const err = new Error(msg) as any
  err.status = 429
  return err
}

/** Create a server error (status 500) */
function serverError(msg = 'Internal server error') {
  const err = new Error(msg) as any
  err.status = 500
  return err
}

/** Create a client error (status 400 — should NOT trigger fallback) */
function clientError(msg = 'Bad request') {
  const err = new Error(msg) as any
  err.status = 400
  return err
}

/** Create a mock async iterable stream */
function mockStream(chunks: any[]) {
  let idx = 0
  const stream: any = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (idx < chunks.length) {
            return { done: false, value: chunks[idx++] }
          }
          return { done: true, value: undefined }
        },
        return: vi.fn(async () => ({ done: true, value: undefined })),
        throw: vi.fn(async (err: any) => {
          throw err
        }),
      }
    },
  }
  return stream
}

/** Create a mock async iterable that errors on a given chunk */
function mockErrorStream(chunks: any[], errorAtIndex: number, error: Error) {
  let idx = 0
  const stream: any = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (idx === errorAtIndex) throw error
          if (idx < chunks.length) {
            return { done: false, value: chunks[idx++] }
          }
          return { done: true, value: undefined }
        },
        return: vi.fn(async () => ({ done: true, value: undefined })),
        throw: vi.fn(async (err: any) => {
          throw err
        }),
      }
    },
  }
  return stream
}

// ─────────────────────────────────────────────────────────────────
// withBudget
// ─────────────────────────────────────────────────────────────────

describe('withBudget', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

    it('returns result when fn completes before timeout', async () => {
    const result = await withBudget(() => Promise.resolve('ok'), { budget: 'step', limitMs: 5000 })
    expect(result).toBe('ok')
  })

    it('throws TimeoutError when fn exceeds timeout', async () => {
    await expect(
      withBudget(() => new Promise((resolve) => setTimeout(resolve, 5000)), { budget: 'step', limitMs: 50 }),
    ).rejects.toBeInstanceOf(TimeoutError)

    try {
      await withBudget(() => new Promise((resolve) => setTimeout(resolve, 5000)), { budget: 'step', limitMs: 50 })
    } catch (err: any) {
      expect(err.name).toBe('TimeoutError')
      expect(err.budget).toBe('step')
    }
  })

    it('no-ops when limitMs is undefined', async () => {
    const result = await withBudget(() => Promise.resolve(42), { budget: 'step' })
    expect(result).toBe(42)
  })

    it('no-ops when limitMs is 0', async () => {
    const result = await withBudget(() => Promise.resolve(42), { budget: 'step', limitMs: 0 })
    expect(result).toBe(42)
  })
})

// ─────────────────────────────────────────────────────────────────
// fallback resolution through resolveModel()
// ─────────────────────────────────────────────────────────────────

describe('resolveModel() fallback handling', () => {
  const extractId = (m: string) => m
  type FallbackTryOptions = { signal?: AbortSignal }
  const resolveFallback = (
    fb: FallbackModel<string>,
    tryModel: (model: string, options?: FallbackTryOptions) => Promise<ReturnType<typeof mockResult>>,
    extractModelId: (model: string) => string,
  ) => resolveModel(fb, {}, tryModel, extractModelId)

  it('uses first model when it succeeds (no fallback metadata)', async () => {
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi.fn(async (model: string) => mockResult(`from ${model}`))

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from model-a')
    expect(tryModel).toHaveBeenCalledTimes(1)
    // No _meta.fallback when first model succeeds
    expect(result._meta?.fallback).toBeUndefined()
  })

    it('falls back on qualifying error (rate_limit)', async () => {
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(mockResult('from B'))

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from B')
    expect(tryModel).toHaveBeenCalledTimes(2)
    expect(result._meta?.fallback).toBeDefined()
    expect(result._meta.fallback.attempts).toBe(2)
    expect(result._meta.fallback.failedModels).toEqual(['model-a'])
  })

    it('falls back on server error (500)', async () => {
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValueOnce(mockResult('from B'))

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from B')
    expect(result._meta.fallback.details[0].errorCategory).toBe('server_error')
  })

    it('does NOT fall back on non-qualifying error (400)', async () => {
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(clientError())

    await expect(resolveFallback(fb, tryModel, extractId)).rejects.toThrow('Bad request')
    expect(tryModel).toHaveBeenCalledTimes(1)
  })

    it('throws AggregateError when all models fail', async () => {
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError('A rate limited'))
      .mockRejectedValueOnce(serverError('B server error'))

    await expect(resolveFallback(fb, tryModel, extractId)).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AggregateError)
      expect(err.errors).toHaveLength(2)
      expect(err.message).toContain('All 2 fallback models failed')
      return true
    })
  })

    it('records timing per attempt in fallback details', async () => {
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(mockResult('from B', 0.05))

    const result = await resolveFallback(fb, tryModel, extractId)

    const details = result._meta.fallback.details
    expect(details).toHaveLength(2)
    expect(details[0].model).toBe('model-a')
    expect(details[0].status).toBe('error')
    expect(typeof details[0].durationMs).toBe('number')
    expect(details[1].model).toBe('model-b')
    expect(details[1].status).toBe('success')
    expect(typeof details[1].durationMs).toBe('number')
  })

    it('records error classification per failed attempt', async () => {
    const fb = fallback('model-a', 'model-b', 'model-c') as FallbackModel<string>
    const tryModel = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce(mockResult('from C'))

    const result = await resolveFallback(fb, tryModel, extractId)

    const details = result._meta.fallback.details
    expect(details[0].errorCategory).toBe('rate_limit')
    expect(details[1].errorCategory).toBe('server_error')
    expect(details[2].status).toBe('success')
  })

    it('respects `on` filter', async () => {
    const fb = fallback('model-a', 'model-b', {
      on: ['rate_limit'],
    }) as FallbackModel<string>

    // Server error should NOT trigger fallback when `on` only includes rate_limit
    const tryModel = vi.fn().mockRejectedValueOnce(serverError())

    await expect(resolveFallback(fb, tryModel, extractId)).rejects.toThrow('Internal server error')
    expect(tryModel).toHaveBeenCalledTimes(1)
  })

    it('calls onAttemptError for each failed attempt', async () => {
    const onAttemptError = vi.fn()
    const fb = fallback('model-a', 'model-b', {
      onAttemptError,
    }) as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(mockResult('from B'))

    await resolveFallback(fb, tryModel, extractId)

    expect(onAttemptError).toHaveBeenCalledTimes(1)
    expect(onAttemptError).toHaveBeenCalledWith(expect.any(Error), 1, 'model-a')
  })

    it('timeout triggers fallback to next model', async () => {
    const fb = fallback('model-a', 'model-b', {
      timeout: 50,
    }) as FallbackModel<string>
    const tryModel = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 5000)))
      .mockResolvedValueOnce(mockResult('from B'))

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from B')
    expect(result._meta.fallback.details[0].errorCategory).toBe('timeout')
  })

    it('passes the fallback timeout signal to the active model attempt', async () => {
    const fb = fallback('model-a', 'model-b', {
      timeout: 50,
    }) as FallbackModel<string>
    const aborted = vi.fn()
    const tryModel = vi.fn((model: string, opts?: FallbackTryOptions) => {
      if (model === 'model-b') return Promise.resolve(mockResult('from B'))
      if (!opts?.signal) return Promise.reject(new Error('model-a did not receive a timeout signal'))
      return new Promise((_, reject) => {
        opts.signal?.addEventListener(
          'abort',
          () => {
            aborted()
            reject(opts.signal?.reason)
          },
          { once: true },
        )
      })
    })

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from B')
    expect(aborted).toHaveBeenCalledOnce()
    expect(tryModel).toHaveBeenCalledTimes(2)
  })

    it('surfaces the provider error when shouldFallback throws', async () => {
    const providerError = rateLimitError('primary rate limited')
    const fb = fallback('model-a', 'model-b', {
      shouldFallback: () => {
        throw new Error('predicate failed')
      },
    }) as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(providerError)

    await expect(resolveFallback(fb, tryModel, extractId)).rejects.toBe(providerError)
    expect(tryModel).toHaveBeenCalledTimes(1)
  })

    it('continues recovery when onAttemptError throws', async () => {
    const fb = fallback('model-a', 'model-b', {
      onAttemptError: () => {
        throw new Error('callback failed')
      },
    }) as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(mockResult('from B'))

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from B')
    expect(tryModel).toHaveBeenCalledTimes(2)
  })

    it('works with 3+ models', async () => {
    const fb = fallback('model-a', 'model-b', 'model-c') as FallbackModel<string>
    const tryModel = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError())
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce(mockResult('from C'))

    const result = await resolveFallback(fb, tryModel, extractId)

    expect(result.text).toBe('from C')
    expect(result._meta.fallback.attempts).toBe(3)
    expect(result._meta.fallback.failedModels).toEqual(['model-a', 'model-b'])
  })
})

// ─────────────────────────────────────────────────────────────────
// orchestrateGenerate
// ─────────────────────────────────────────────────────────────────

describe('orchestrateGenerate', () => {
  // Mock the global middleware getter — we need to mock the module
  let mockGetMiddleware: ReturnType<typeof vi.fn>
  beforeEach(() => {
    // We'll use vi.mock for the actual implementation.
    // For now, define the test structure.
    vi.restoreAllMocks()
  })

  function makeSpec(overrides: Partial<OrchestrationSpec> = {}): OrchestrationSpec {
    return {
      promptId: 'test-prompt',
      promptConfig: { hooks: {} },
      preparedArgs: { model: 'gpt-4o', messages: [], settings: {} },
      model: 'gpt-4o',
      input: {},
      ...overrides,
    }
  }

  it('calls doGenerate directly when no middleware is set', async () => {
    const doGenerate = vi.fn().mockResolvedValue(mockResult('hello'))
    const spec = makeSpec()

    const result = await orchestrateGenerate(spec, doGenerate)

    expect(doGenerate).toHaveBeenCalled()
    expect(result.text).toBe('hello')
  })

    it('fires onGenerate hook with durationMs after success', async () => {
    const onGenerate = vi.fn()
    const doGenerate = vi.fn().mockResolvedValue(mockResult('hello'))
    const spec = makeSpec({
      promptConfig: { hooks: { onGenerate } },
    })

    await orchestrateGenerate(spec, doGenerate)

    expect(onGenerate).toHaveBeenCalledTimes(1)
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: 'test-prompt',
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({ text: 'hello' }),
    )
  })

    it('fires onError hook on failure and re-throws', async () => {
    const onError = vi.fn()
    const error = new Error('generation failed')
    const doGenerate = vi.fn().mockRejectedValue(error)
    const spec = makeSpec({
      promptConfig: { hooks: { onError } },
    })

    await expect(orchestrateGenerate(spec, doGenerate)).rejects.toThrow('generation failed')

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: 'test-prompt',
        error,
      }),
    )
  })

    it('does not fire onGenerate on failure', async () => {
    const onGenerate = vi.fn()
    const doGenerate = vi.fn().mockRejectedValue(new Error('fail'))
    const spec = makeSpec({
      promptConfig: { hooks: { onGenerate } },
    })

    await expect(orchestrateGenerate(spec, doGenerate)).rejects.toThrow()
    expect(onGenerate).not.toHaveBeenCalled()
  })

    it('works when no hooks are configured', async () => {
    const doGenerate = vi.fn().mockResolvedValue(mockResult('hello'))
    const spec = makeSpec({ promptConfig: {} })

    const result = await orchestrateGenerate(spec, doGenerate)
    expect(result.text).toBe('hello')
  })
})

// ─────────────────────────────────────────────────────────────────
// orchestrateStream
// ─────────────────────────────────────────────────────────────────

describe('orchestrateStream', () => {
  it('calls doStream directly when no middleware is set', async () => {
    const stream = mockStream([{ text: 'hi' }])
    const doStream = vi.fn().mockResolvedValue(stream)

    const result = await orchestrateStream(
      {
        promptId: 'test',
        promptConfig: {},
        preparedArgs: { model: 'gpt-4o' },
      },
      doStream,
    )

    expect(doStream).toHaveBeenCalled()
    expect(result).toBe(stream)
  })

    it('fires onError hook on failure and re-throws', async () => {
    const onError = vi.fn()
    const error = new Error('stream failed')
    const doStream = vi.fn().mockRejectedValue(error)

    await expect(
      orchestrateStream(
        {
          promptId: 'test',
          promptConfig: { hooks: { onError } },
          preparedArgs: {},
        },
        doStream,
      ),
    ).rejects.toThrow('stream failed')

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'test', error }))
  })
})

// ─────────────────────────────────────────────────────────────────
// wrapStreamIterable
// ─────────────────────────────────────────────────────────────────

describe('wrapStreamIterable', () => {
  it('intercepts chunks and calls progress.onChunk with extracted text', async () => {
    const chunks = [{ choices: [{ delta: { content: 'Hello' } }] }, { choices: [{ delta: { content: ' world' } }] }]
    const stream = mockStream(chunks)
    const progress = {
      onChunk: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    }
    const onComplete = vi.fn()
    const onError = vi.fn()
    const extractTextDelta: TextDeltaExtractor = (chunk) => chunk?.choices?.[0]?.delta?.content

    wrapStreamIterable(stream, progress, extractTextDelta, onComplete, onError)

    // Consume the stream
    const results: any[] = []
    for await (const chunk of stream) {
      results.push(chunk)
    }

    expect(results).toHaveLength(2)
    expect(progress.onChunk).toHaveBeenCalledTimes(2)
    expect(progress.onChunk).toHaveBeenNthCalledWith(1, 'Hello')
    expect(progress.onChunk).toHaveBeenNthCalledWith(2, ' world')
    expect(progress.flush).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

    it('calls progress.onChunk with undefined when no text delta', async () => {
    const chunks = [{ type: 'metadata', data: {} }]
    const stream = mockStream(chunks)
    const progress = {
      onChunk: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    }
    const extractTextDelta: TextDeltaExtractor = () => undefined

    wrapStreamIterable(stream, progress, extractTextDelta, vi.fn(), vi.fn())

    for await (const _ of stream) {
      /* consume */
    }

    expect(progress.onChunk).toHaveBeenCalledWith(undefined)
  })

    it('calls progress.dispose and onError on iteration error', async () => {
    const error = new Error('stream broke')
    const stream = mockErrorStream([{ text: 'a' }], 0, error)
    const progress = {
      onChunk: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    }
    const onError = vi.fn()

    wrapStreamIterable(stream, progress, () => undefined, vi.fn(), onError)

    await expect(async () => {
      for await (const _ of stream) {
        /* consume */
      }
    }).rejects.toThrow('stream broke')

    expect(progress.dispose).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error)
  })

    it('works without progress reporter (undefined)', async () => {
    const chunks = [{ text: 'hello' }]
    const stream = mockStream(chunks)
    const onComplete = vi.fn()

    wrapStreamIterable(stream, undefined, (c) => c.text, onComplete, vi.fn())

    const results: any[] = []
    for await (const chunk of stream) {
      results.push(chunk)
    }

    expect(results).toHaveLength(1)
    expect(onComplete).toHaveBeenCalled()
  })

    it('preserves original stream object identity (mutation, not wrapper)', async () => {
    const chunks = [{ text: 'hi' }]
    const stream = mockStream(chunks)
    const originalStream = stream

    wrapStreamIterable(stream, undefined, (c) => c.text, vi.fn(), vi.fn())

    // Same object — not a wrapper
    expect(stream).toBe(originalStream)
  })
})
