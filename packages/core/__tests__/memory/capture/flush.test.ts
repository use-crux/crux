import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { memory, memoryBlock } from '../../../src/memory'
import { prompt as makePrompt } from '../../../src/prompt/prompt'
import { config } from '../../../src/runtime/config'
import { testAdapter } from './fixtures'

describe('memory capture flush', () => {
  it('excludes capture accepted after the flush cutoff', async () => {
    const releases = new Map<string, () => void>()
    const gates = new Map<string, Promise<void>>()
    for (const message of ['first', 'second']) {
      gates.set(
        message,
        new Promise<void>((resolve) => {
          releases.set(message, resolve)
        }),
      )
    }
    const crux = config({
      host: {
        kind: 'memory-cutoff-test',
        invocationScope: true,
        retain() {},
      },
    })
    const mem = memory({
      id: 'flush-cutoff',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async (turn) => {
            const message = turn.messages[0]?.content
            if (message) await gates.get(message)
          },
        }),
      ],
    })
    const p = makePrompt({
      id: 'flush-cutoff-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })

    try {
      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'first' },
      })
      let firstFlushed = false
      const firstFlush = mem.flush().then(() => {
        firstFlushed = true
      })

      await testAdapter().generate(p, {
        model: 'model-1',
        input: { message: 'second' },
      })
      releases.get('first')?.()
      await firstFlush
      expect(firstFlushed).toBe(true)

      let secondFlushed = false
      const secondFlush = mem.flush().then(() => {
        secondFlushed = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(secondFlushed).toBe(false)

      releases.get('second')?.()
      await secondFlush
      expect(secondFlushed).toBe(true)
    } finally {
      releases.get('first')?.()
      releases.get('second')?.()
      crux.dispose()
    }
  })

  it('runs block flush hooks after capture in declaration order', async () => {
    const calls: string[] = []
    const block = (id: string) =>
      memoryBlock({
        id,
        kind: 'custom',
        captureTurn: async () => {
          calls.push(`capture:${id}`)
        },
        flush: async () => {
          calls.push(`flush:${id}`)
        },
      })
    const mem = memory({
      id: 'ordered-flush',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [block('a'), block('b')],
    })

    await mem.captureTurn({ messages: [] })
    await mem.flush()

    expect(calls).toEqual([
      'capture:a',
      'capture:b',
      'flush:a',
      'flush:b',
    ])
  })
})
