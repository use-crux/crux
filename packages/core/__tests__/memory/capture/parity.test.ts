import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { memory, memoryBlock } from '../../../src/memory'
import { prompt as makePrompt } from '../../../src/prompt/prompt'
import { config } from '../../../src/runtime/config'
import { testAdapter } from './fixtures'

describe('memory capture generation parity', () => {
  it('keeps generate and stream completion ahead of retained capture', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const retainedWork: Array<() => Promise<void>> = []
    const retain = vi.fn((work: () => Promise<void>) => {
      retainedWork.push(work)
    })
    const crux = config({
      host: { kind: 'memory-parity-test', invocationScope: true, retain },
    })
    const capture = vi.fn(async () => captureCanFinish)
    const mem = memory({
      id: 'generation-parity',
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
      id: 'generation-parity-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const adapter = testAdapter('streamed answer')

    try {
      await adapter.generate(p, {
        model: 'model-1',
        input: { message: 'Generate' },
      })
      await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1))

      const result = await adapter.stream(p, {
        model: 'model-1',
        input: { message: 'Stream' },
      })
      const chunks: string[] = []
      for await (const chunk of result.textStream) chunks.push(chunk)
      expect(chunks).toEqual(['streamed answer'])

      await expect(result.completion).resolves.toBeDefined()
      await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2))
      expect(retain).toHaveBeenCalledTimes(2)

      releaseCapture()
      await Promise.all(retainedWork.map((work) => work()))
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })

  it('captures one completed turn and each tool event for every binding', async () => {
    const firstTurn = vi.fn(async () => {})
    const firstEvent = vi.fn(async () => {})
    const secondTurn = vi.fn(async () => {})
    const secondEvent = vi.fn(async () => {})
    const binding = (
      id: string,
      captureTurn: typeof firstTurn,
      captureToolEvent: typeof firstEvent,
    ) =>
      memory({
        id,
        namespace: 'thread:1',
        capture: { mode: 'inline' },
        blocks: [
          memoryBlock({
            id: 'capture',
            kind: 'custom',
            captureTurn,
            captureToolEvent,
          }),
        ],
      })
    const p = makePrompt({
      id: 'multiple-memory-bindings',
      use: [
        binding('first', firstTurn, firstEvent),
        binding('second', secondTurn, secondEvent),
      ],
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

    await testAdapter('done', [
      { id: 'tool-call-1', name: 'lookup', args: { query: 'memory' } },
    ]).generate(p, {
      model: 'model-1',
      input: { message: 'Use lookup' },
    })

    expect(firstTurn).toHaveBeenCalledOnce()
    expect(secondTurn).toHaveBeenCalledOnce()
    expect(firstEvent).toHaveBeenCalledOnce()
    expect(secondEvent).toHaveBeenCalledOnce()
  })
})
