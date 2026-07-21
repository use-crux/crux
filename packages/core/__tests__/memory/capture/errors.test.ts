import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { memory, memoryBlock } from '../../../src/memory'
import { prompt as makePrompt } from '../../../src/prompt/prompt'
import { config } from '../../../src/runtime/config'
import { testAdapter } from './fixtures'

describe('memory capture errors', () => {
  it('rejects generation with the original deferred fallback error', async () => {
    const captureError = new Error('capture failed')
    const mem = memory({
      id: 'rejected-deferred-capture',
      namespace: 'thread:1',
      capture: { mode: 'deferred' },
      blocks: [
        memoryBlock({
          id: 'rejected-capture',
          kind: 'custom',
          captureTurn: async () => {
            throw captureError
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'rejected-deferred-capture-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    await expect(
      testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'Hello' },
      }),
    ).rejects.toBe(captureError)
  })

  it('propagates a configured retain failure without running capture twice', async () => {
    const retainError = new Error('retain failed')
    const capture = vi.fn(async () => {})
    const crux = config({
      host: {
        kind: 'memory-retain-failure-test',
        invocationScope: true,
        retain() {
          throw retainError
        },
      },
    })
    const mem = memory({
      id: 'retain-failure',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: capture,
        }),
      ],
    })
    const p = makePrompt({
      id: 'retain-failure-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await expect(
        testAdapter().generate(p, {
          model: 'model-1',
          input: { message: 'Hello' },
        }),
      ).rejects.toBe(retainError)
      expect(capture).toHaveBeenCalledOnce()
    } finally {
      crux.dispose()
    }
  })

  it('isolates a retained capture failure from settled generation', async () => {
    const captureError = new Error('retained capture failed')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    let retainedWork: (() => Promise<void>) | undefined
    const crux = config({
      host: {
        kind: 'memory-deferred-error-test',
        invocationScope: true,
        retain(work) {
          retainedWork = work
        },
      },
    })
    const mem = memory({
      id: 'isolated-deferred-error',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async () => {
            throw captureError
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'isolated-deferred-error-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await expect(
        testAdapter().generate(p, {
          model: 'model-1',
          input: { message: 'Hello' },
        }),
      ).resolves.toBeDefined()
      await retainedWork?.()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      crux.dispose()
    }
  })

  it('reports the original retained capture failure from a later flush', async () => {
    const captureError = new Error('retained capture failed')
    let retainedWork: (() => Promise<void>) | undefined
    const crux = config({
      host: {
        kind: 'memory-flush-error-test',
        invocationScope: true,
        retain(work) {
          retainedWork = work
        },
      },
    })
    const mem = memory({
      id: 'reported-deferred-error',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async () => {
            throw captureError
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'reported-deferred-error-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'Hello' },
      })
      await retainedWork?.()

      await expect(mem.flush()).rejects.toBe(captureError)
      await expect(mem.flush()).resolves.toBeUndefined()
    } finally {
      crux.dispose()
    }
  })

  it('reports one deferred failure only from the first overlapping flush', async () => {
    const captureError = new Error('overlapping flush failure')
    let releaseCapture!: () => void
    const captureCanFail = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const crux = config({
      host: {
        kind: 'memory-overlapping-flush-test',
        invocationScope: true,
        retain() {},
      },
    })
    const mem = memory({
      id: 'overlapping-flush-error',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async () => {
            await captureCanFail
            throw captureError
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'overlapping-flush-error-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'Hello' },
      })
      const firstFlush = mem.flush()
      const secondFlush = mem.flush()

      releaseCapture()

      await expect(firstFlush).rejects.toBe(captureError)
      await expect(secondFlush).resolves.toBeUndefined()
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })

  it('consumes every deferred failure in the closed epoch after reporting the earliest', async () => {
    const firstError = new Error('first failure')
    const secondError = new Error('second failure')
    let releaseCaptures!: () => void
    const capturesCanFail = new Promise<void>((resolve) => {
      releaseCaptures = resolve
    })
    let captureCount = 0
    const crux = config({
      host: {
        kind: 'memory-epoch-failure-test',
        invocationScope: true,
        retain() {},
      },
    })
    const mem = memory({
      id: 'epoch-failures',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async () => {
            const error = captureCount++ === 0 ? firstError : secondError
            await capturesCanFail
            throw error
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'epoch-failures-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'First' },
      })
      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'Second' },
      })
      const firstFlush = mem.flush()
      const secondFlush = mem.flush()

      releaseCaptures()

      await expect(firstFlush).rejects.toBe(firstError)
      await expect(secondFlush).resolves.toBeUndefined()
    } finally {
      releaseCaptures()
      crux.dispose()
    }
  })
})
