import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../../src/prompt/prompt'
import { memory, memoryBlock } from '../../../src/memory'
import { testAdapter } from './fixtures'

describe('memory capture lifecycle', () => {
  it('waits safely for deferred capture when no host can retain it', async () => {
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
      id: 'deferred-without-host',
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
      id: 'deferred-without-host-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    let generated = false
    const generation = testAdapter()
      .generate(p, { model: 'model-1', input: { message: 'Hello' } })
      .then(() => {
        generated = true
    })

    await captureDidStart
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(generated).toBe(false)

    releaseCapture()
    await generation
    expect(writes).toEqual(['captured'])
  })

  it('awaits block capture work when capture mode is inline', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const capturedNamespaces: string[] = []
    const mem = memory({
      id: 'inline-capture',
      namespace: ({ input }) => `thread:${input.threadId}`,
      capture: { mode: 'inline' },
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async (_turn, ctx) => {
            await captureCanFinish
            capturedNamespaces.push(ctx.namespace)
          },
        }),
      ],
    })

    let resolved = false
    const capture = mem
      .captureTurn(
        { messages: [{ role: 'user', content: 'hi' }] },
        { input: { threadId: 't1' } },
      )
      .then(() => {
        resolved = true
      })

    await Promise.resolve()
    expect(resolved).toBe(false)

    releaseCapture()
    await capture
    expect(capturedNamespaces).toEqual(['thread:t1'])
  })

  it('uses safe deferred capture when the mode is omitted', async () => {
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
      id: 'default-deferred-capture',
      namespace: 'thread:1',
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
      id: 'default-deferred-capture-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    let generated = false
    const generation = testAdapter()
      .generate(p, { model: 'model-1', input: { message: 'Hello' } })
      .then(() => {
        generated = true
      })
    await captureDidStart
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(generated).toBe(false)

    releaseCapture()
    await generation
    expect(writes).toEqual(['captured'])
  })

  it('waits for direct deferred capture outside a Crux scope', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const writes: string[] = []
    const mem = memory({
      id: 'direct-deferred-capture',
      namespace: 'thread:1',
      capture: { mode: 'deferred' },
      blocks: [
        memoryBlock({
          id: 'slow-capture',
          kind: 'custom',
          captureTurn: async () => {
            await captureCanFinish
            writes.push('captured')
          },
        }),
      ],
    })

    let captured = false
    const capture = mem
      .captureTurn({ messages: [{ role: 'user', content: 'Hello' }] })
      .then(() => {
        captured = true
      })
    await Promise.resolve()
    expect(captured).toBe(false)

    releaseCapture()
    await capture
    expect(writes).toEqual(['captured'])
  })

  it('captures a completed turn before tool events in deterministic order', async () => {
    const calls: string[] = []
    const block = (id: string) =>
      memoryBlock({
        id,
        kind: 'custom',
        captureTurn: async () => {
          calls.push(`turn:${id}`)
        },
        captureToolEvent: async (event) => {
          calls.push(`event:${event.toolCallId}:${id}`)
        },
      })
    const mem = memory({
      id: 'ordered-capture',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [block('a'), block('b')],
    })

    await mem.captureTurn({
      messages: [{ role: 'user', content: 'Use both tools' }],
      toolEvents: [
        { toolCallId: '1', toolName: 'first' },
        { toolCallId: '2', toolName: 'second' },
      ],
    })

    expect(calls).toEqual([
      'turn:a',
      'turn:b',
      'event:1:a',
      'event:1:b',
      'event:2:a',
      'event:2:b',
    ])
  })

  it('captures each adapter tool event exactly once through the completed turn', async () => {
    const capturedEvents: string[] = []
    const mem = memory({
      id: 'adapter-completed-turn',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureToolEvent: async (event) => {
            capturedEvents.push(event.toolCallId ?? 'missing')
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'adapter-completed-turn-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
      tools: {
        lookup: {
          description: 'Look up a value.',
          parameters: z.object({ query: z.string() }),
          execute: async () => ({ answer: 'found' }),
        },
      },
    })
    const adapter = testAdapter('done', [
      { id: 'tool-call-1', name: 'lookup', args: { query: 'memory' } },
    ])

    await adapter.generate(p, {
      model: 'model-1',
      input: { message: 'Use lookup' },
    })

    expect(capturedEvents).toEqual(['tool-call-1'])
  })

})
