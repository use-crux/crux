import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { memory, memoryBlock } from '../../../src/memory'
import { prompt as makePrompt } from '../../../src/prompt/prompt'
import { config } from '../../../src/runtime/config'
import { testAdapter } from './fixtures'

describe('memory capture retention', () => {
  it('keeps inline capture on the generation path without retaining it', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    let captureStarted!: () => void
    const captureDidStart = new Promise<void>((resolve) => {
      captureStarted = resolve
    })
    const writes: string[] = []
    const mem = memory({
      id: 'inline-adapter-capture',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [
        memoryBlock({
          id: 'slow-capture',
          kind: 'custom',
          captureTurn: async () => {
            captureStarted()
            await captureCanFinish
            writes.push('captured')
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'inline-adapter-capture-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const retain = vi.fn()
    const crux = config({
      host: { kind: 'memory-inline-test', invocationScope: true, retain },
    })

    try {
      let generated = false
      const generation = testAdapter()
        .generate(p, { model: 'model-1', input: { message: 'Hello' } })
        .then(() => {
          generated = true
        })
      await captureDidStart
      expect(generated).toBe(false)
      expect(retain).not.toHaveBeenCalled()

      releaseCapture()
      await generation
      expect(writes).toEqual(['captured'])
      expect(retain).not.toHaveBeenCalled()
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })

  it('returns before retained deferred capture completes', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    let captureStarted!: () => void
    const captureDidStart = new Promise<void>((resolve) => {
      captureStarted = resolve
    })
    let retainedWork: (() => Promise<void>) | undefined
    const retain = vi.fn((work: () => Promise<void>) => {
      retainedWork = work
    })
    const crux = config({
      host: { kind: 'memory-deferred-test', invocationScope: true, retain },
    })
    const writes: string[] = []
    const mem = memory({
      id: 'retained-deferred-capture',
      namespace: 'thread:1',
      capture: { mode: 'deferred' },
      blocks: [
        memoryBlock({
          id: 'slow-capture',
          kind: 'custom',
          captureTurn: async () => {
            captureStarted()
            await captureCanFinish
            writes.push('captured')
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'retained-deferred-capture-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      let generated = false
      const generation = testAdapter()
        .generate(p, { model: 'model-1', input: { message: 'Hello' } })
        .then(() => {
          generated = true
        })

      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(retain).toHaveBeenCalledOnce()
      expect(generated).toBe(true)
      expect(writes).toEqual([])

      const retained = retainedWork?.()
      await captureDidStart
      expect(writes).toEqual([])

      releaseCapture()
      await retained
      await generation
      expect(writes).toEqual(['captured'])
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })

  it('falls back inline when the configured host is named-only', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    let captureStarted!: () => void
    const captureDidStart = new Promise<void>((resolve) => {
      captureStarted = resolve
    })
    const retain = vi.fn()
    const crux = config({
      host: {
        kind: 'memory-named-only-test',
        invocationScope: false,
        supportsInline: false,
        retain,
      },
    })
    const mem = memory({
      id: 'named-only-fallback',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async () => {
            captureStarted()
            await captureCanFinish
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'named-only-fallback-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      let generated = false
      const generation = testAdapter()
        .generate(p, { model: 'model-1', input: { message: 'Hello' } })
        .then(() => {
          generated = true
        })
      await captureDidStart
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(generated).toBe(false)
      expect(retain).not.toHaveBeenCalled()

      releaseCapture()
      await generation
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })

  it('flush waits for retained capture accepted before the call', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    let captureStarted!: () => void
    const captureDidStart = new Promise<void>((resolve) => {
      captureStarted = resolve
    })
    let retainedWork: (() => Promise<void>) | undefined
    const crux = config({
      host: {
        kind: 'memory-flush-test',
        invocationScope: true,
        retain(work) {
          retainedWork = work
        },
      },
    })
    const mem = memory({
      id: 'retained-flush',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async () => {
            captureStarted()
            await captureCanFinish
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'retained-flush-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'Hello' },
      })

      let flushed = false
      const flush = mem.flush().then(() => {
        flushed = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(flushed).toBe(false)

      const retained = retainedWork?.()
      await captureDidStart
      expect(flushed).toBe(false)

      releaseCapture()
      await retained
      await flush
      expect(flushed).toBe(true)
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })
})
