/**
 * Mapping an ordinary provider stream onto the logical port (contract 06 step 4).
 *
 * The ordinary (non-coordinated) route has one physical attempt, but its PUBLIC shape
 * must already be the logical one: a single `start`, published text, one `finish`, and no
 * provider-step framing. This is the adapter both ordinary routes share, so native and
 * SDK cannot drift in what they publish.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { publishOrdinaryStream } from '../../src/adapter/execution/logical-stream-mapping'

const meta = { traceId: 't', spanId: 's' } as never
const runId = 'run_1' as never

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = []
  for await (const value of stream) seen.push(value)
  return seen
}

describe('ordinary stream mapping', () => {
  it('emits one logical start, published text, and one finish', async () => {
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'hello ' }
        yield { type: 'text-delta' as const, text: 'world' }
      })(),
      completion: async () => ({ text: 'hello world', finalStep: { finishReason: 'stop' } }) as never,
    })

    const events = await drain(result.fullStream)
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'text-delta',
      'text-delta',
      'finish',
    ])
    // Exactly one of each framing event, and `finish` is last.
    expect(events.filter((event) => event.type === 'start')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('finish')
  })

  it('publishes no provider step framing', async () => {
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'x' }
      })(),
      completion: async () => ({ text: 'x' }) as never,
    })
    const types = (await drain(result.fullStream)).map((event) => event.type)
    for (const forbidden of ['start-step', 'finish-step', 'text-start', 'text-end']) {
      expect(types).not.toContain(forbidden)
    }
  })

  it('carries the logical finish reason and usage onto the finish event', async () => {
    const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'x' }
      })(),
      completion: async () => ({ text: 'x', finalStep: { finishReason: 'stop' }, usage }) as never,
    })
    const events = await drain(result.fullStream)
    const finish = events.at(-1)
    expect(finish).toMatchObject({ type: 'finish', finishReason: 'stop', usage })
  })

  it('settles completion without any surface being read', async () => {
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'x' }
      })(),
      completion: async () => ({ text: 'x' }) as never,
    })
    await expect(
      Promise.race([
        result.completion,
        new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock')), 2000)),
      ]),
    ).resolves.toBeDefined()
  })

  it('fails every surface with one identity and emits no finish', async () => {
    const failure = new Error('provider exploded')
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'committed' }
        throw failure
      })(),
      completion: async () => ({ text: '' }) as never,
    })

    const seen: unknown[] = []
    let thrown: unknown
    try {
      for await (const event of result.fullStream) seen.push(event)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(failure)
    // A terminal failure never publishes `finish`.
    expect(seen.map((event) => (event as { type: string }).type)).not.toContain('finish')
    await expect(result.completion).rejects.toBe(failure)
  })

  it('aborts the physical attempt when the caller cancels', async () => {
    const onCancel = vi.fn()
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'x' }
        await new Promise(() => undefined) // never settles on its own
      })(),
      completion: async () => ({ text: 'x' }) as never,
      onCancel,
    })
    const reason = new Error('cancelled')
    result.cancel(reason)
    expect(onCancel).toHaveBeenCalledWith(reason)
    await expect(result.completion).rejects.toBe(reason)
  })
})

// One canonical sequence: a two-source API drained text first and everything else after,
// destroying the interleaving a caller actually observed. Order must be preserved exactly.
describe('canonical event ordering', () => {
  it('preserves the producer interleaving across event kinds', async () => {
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'a' }
        yield { type: 'reasoning-delta' as const, text: 'thinking' }
        yield { type: 'partial-output' as const, value: { a: 1 } }
        yield { type: 'text-delta' as const, text: 'b' }
        yield {
          type: 'tool-call' as const,
          toolCallId: 't1',
          toolName: 'lookup',
          input: {},
        }
      })(),
      completion: async () => ({ text: 'ab' }) as never,
    })

    expect((await drain(result.fullStream)).map((event) => event.type)).toEqual([
      'start',
      'text-delta',
      'reasoning-delta',
      'partial-output',
      'text-delta',
      'tool-call',
      'finish',
    ])
  })

  it('projects textStream from that one sequence, in order', async () => {
    const result = publishOrdinaryStream({
      runId,
      meta,
      events: (async function* () {
        yield { type: 'text-delta' as const, text: 'a' }
        yield { type: 'reasoning-delta' as const, text: 'ignored by textStream' }
        yield { type: 'text-delta' as const, text: 'b' }
      })(),
      completion: async () => ({ text: 'ab' }) as never,
    })
    expect(await drain(result.textStream)).toEqual(['a', 'b'])
  })
})
