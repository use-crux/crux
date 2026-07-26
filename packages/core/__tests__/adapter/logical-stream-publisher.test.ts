/**
 * The logical stream publisher (RFC #173, contract 06).
 *
 * Composes the shared replay log into the public `StreamResult`: three projections over
 * one log, a completion promise independent of consumption, cancellation with shared
 * error identity, and the callback laws (logical, serialized, at-most-once, never both
 * terminal callbacks, exceptions diagnostic-only).
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { createLogicalStream } from '../../src/adapter/logical-stream-publisher'
import type { StreamEvent } from '../../src/adapter/logical-stream'

const meta = { traceId: 't', spanId: 's' } as never
const runId = 'run_1' as never

function make(overrides?: Parameters<typeof createLogicalStream>[0]) {
  return createLogicalStream({ runId, meta, ...overrides })
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = []
  for await (const value of stream) seen.push(value)
  return seen
}

describe('logical stream publisher', () => {
  it('projects text, full, and partial surfaces from one log', async () => {
    const { result, publisher } = make()
    publisher.publish({ type: 'start' })
    publisher.publish({ type: 'text-delta', text: 'hello ' })
    publisher.publish({ type: 'partial-output', value: { a: 1 } })
    publisher.publish({ type: 'text-delta', text: 'world' })
    publisher.publish({ type: 'finish', finishReason: 'stop' })
    publisher.complete({ text: 'hello world' } as never)

    expect(await drain(result.textStream)).toEqual(['hello ', 'world'])
    expect(await drain(result.partialOutputStream)).toEqual([{ a: 1 }])
    const full = await drain(result.fullStream)
    expect(full.map((event) => event.type)).toEqual([
      'start',
      'text-delta',
      'partial-output',
      'text-delta',
      'finish',
    ])
  })

  it('memoizes each surface so repeated access is the same object', () => {
    const { result } = make()
    expect(result.textStream).toBe(result.textStream)
    expect(result.fullStream).toBe(result.fullStream)
    expect(result.partialOutputStream).toBe(result.partialOutputStream)
  })

  it('settles completion without any surface being drained', async () => {
    const { result, publisher } = make()
    publisher.publish({ type: 'text-delta', text: 'x' })
    publisher.complete({ text: 'x' } as never)
    await expect(
      Promise.race([
        result.completion,
        new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock')), 2000)),
      ]),
    ).resolves.toBeDefined()
  })

  it('closes partialOutputStream immediately for a text-only stream', async () => {
    const { result, publisher } = make()
    publisher.publish({ type: 'text-delta', text: 'x' })
    publisher.complete({ text: 'x' } as never)
    expect(await drain(result.partialOutputStream)).toEqual([])
  })

  it('fails every surface and completion with one error identity', async () => {
    const { result, publisher } = make()
    const failure = new Error('terminal')
    publisher.publish({ type: 'text-delta', text: 'committed' })
    publisher.fail(failure)

    const seen: string[] = []
    let streamError: unknown
    try {
      for await (const chunk of result.textStream) seen.push(chunk)
    } catch (error) {
      streamError = error
    }
    expect(seen).toEqual(['committed'])
    expect(streamError).toBe(failure)
    await expect(result.completion).rejects.toBe(failure)
  })

  it('cancel() aborts every surface with the same identity', async () => {
    const { result } = make()
    const reason = new Error('caller cancelled')
    result.cancel(reason)
    await expect(result.completion).rejects.toBe(reason)
    await expect(drain(result.fullStream)).rejects.toBe(reason)
  })
})

describe('logical stream callbacks', () => {
  it('delivers onChunk for published events and onFinish exactly once', async () => {
    const onChunk = vi.fn()
    const onFinish = vi.fn()
    const onError = vi.fn()
    const { result, publisher } = make({ runId, meta, onChunk, onFinish, onError } as never)
    publisher.publish({ type: 'text-delta', text: 'a' })
    publisher.publish({ type: 'finish' })
    publisher.complete({ text: 'a' } as never)
    await result.completion

    expect(onChunk).toHaveBeenCalledTimes(2)
    expect((onChunk.mock.calls[0]?.[0] as StreamEvent).type).toBe('text-delta')
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('runs onError once on failure and never onFinish', async () => {
    const onFinish = vi.fn()
    const onError = vi.fn()
    const { result, publisher } = make({ runId, meta, onFinish, onError } as never)
    publisher.fail(new Error('boom'))
    await result.completion.catch(() => undefined)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('treats cancellation as an error, never a finish', async () => {
    const onFinish = vi.fn()
    const onError = vi.fn()
    const { result } = make({ runId, meta, onFinish, onError } as never)
    result.cancel(new Error('cancelled'))
    await result.completion.catch(() => undefined)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('drains the callback queue before completion settles', async () => {
    const order: string[] = []
    const onChunk = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('chunk')
    })
    const onFinish = vi.fn(() => {
      order.push('finish')
    })
    const { result, publisher } = make({ runId, meta, onChunk, onFinish } as never)
    publisher.publish({ type: 'text-delta', text: 'a' })
    publisher.complete({ text: 'a' } as never)
    await result.completion

    // Awaiting completion guarantees the terminal callback already ran, in order.
    expect(order).toEqual(['chunk', 'finish'])
  })

  it('isolates a callback exception from the operation outcome', async () => {
    const onChunk = vi.fn(() => {
      throw new Error('callback exploded')
    })
    const onError = vi.fn()
    const { result, publisher } = make({ runId, meta, onChunk, onError } as never)
    publisher.publish({ type: 'text-delta', text: 'a' })
    publisher.complete({ text: 'a' } as never)

    // The stream and completion are unaffected; onError is not invoked for a callback bug.
    expect(await drain(result.textStream)).toEqual(['a'])
    await expect(result.completion).resolves.toBeDefined()
    expect(onError).not.toHaveBeenCalled()
  })
})

// Contract: "retained events exist once, not once per surface." An eagerly-draining
// projection would materialize a second copy inside each stream's internal queue.
describe('logical stream retention', () => {
  it('does not materialize a per-surface copy of the log', async () => {
    const { result, publisher } = make()
    // Touch every surface WITHOUT reading any of them.
    void result.textStream
    void result.fullStream
    void result.partialOutputStream

    // Each published event counts how many surfaces inspected it. A projection
    // that drained into its own queue would inspect every event immediately, so
    // the count reveals a materialized copy that a length assertion cannot —
    // a per-surface copy still replays 50 events.
    const inspections = new Map<number, number>()
    for (let index = 0; index < 50; index += 1) {
      const event = {
        text: `d${index}`,
        get type() {
          inspections.set(index, (inspections.get(index) ?? 0) + 1)
          return 'text-delta' as const
        },
      }
      publisher.publish(event as never)
    }
    // Let any parked projection resume BEFORE asserting: publication is
    // synchronous, so without this every surface is still parked and a
    // prefetching projection would look identical to a correct one.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Untouched surfaces pulled nothing.
    expect([...inspections.values()]).toEqual([])
    publisher.complete({ text: 'x' } as never)

    // …and the one shared log still replays every event in full.
    expect(await drain(result.textStream)).toHaveLength(50)
    expect(await drain(result.fullStream)).toHaveLength(50)
  })

  it('lets one reader cancel without disturbing the others', async () => {
    const { result, publisher } = make()
    publisher.publish({ type: 'text-delta', text: 'a' })

    const reader = result.fullStream.getReader()
    await reader.read()
    await reader.cancel()

    publisher.publish({ type: 'text-delta', text: 'b' })
    publisher.complete({ text: 'ab' } as never)

    // The cancelled reader detached; the other surface is unaffected.
    expect(await drain(result.textStream)).toEqual(['a', 'b'])
    await expect(result.completion).resolves.toBeDefined()
  })
})

// Callbacks may delay `completion` (contracted) but must never delay publication,
// closing, failure, or cancellation of the stream surfaces.
describe('callbacks cannot gate surface settlement', () => {
  it('closes surfaces while a slow callback is still running', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const { result, publisher } = make({
      runId,
      meta,
      onChunk: () => blocked,
    } as never)
    publisher.publish({ type: 'text-delta', text: 'a' })
    publisher.complete({ text: 'a' } as never)

    // Surfaces settle now, without waiting for the hung callback.
    expect(
      await Promise.race([
        drain(result.textStream),
        new Promise((_, reject) => setTimeout(() => reject(new Error('surface hung')), 1000)),
      ]),
    ).toEqual(['a'])
    release()
    await result.completion
  })

  it('makes cancellation observable while a callback is hung', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const { result, publisher } = make({ runId, meta, onChunk: () => blocked } as never)
    publisher.publish({ type: 'text-delta', text: 'a' })
    const reason = new Error('cancelled')
    result.cancel(reason)

    await expect(
      Promise.race([
        drain(result.fullStream).catch((error: unknown) => error),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 1000)),
      ]),
    ).resolves.toBe(reason)
    release()
  })
})

describe('cancellation hardening', () => {
  it('still rejects when onCancel throws', async () => {
    const { result } = make({
      runId,
      meta,
      onCancel: () => {
        throw new Error('abort hook exploded')
      },
    } as never)
    const reason = new Error('cancelled')
    result.cancel(reason)
    await expect(result.completion).rejects.toBe(reason)
  })

  it('is a no-op after settlement and does not invoke onCancel', async () => {
    const onCancel = vi.fn()
    const { result, publisher } = make({ runId, meta, onCancel } as never)
    publisher.complete({ text: 'done' } as never)
    await result.completion
    result.cancel(new Error('too late'))
    expect(onCancel).not.toHaveBeenCalled()
    await expect(result.completion).resolves.toBeDefined()
  })

  it('normalizes a non-Error reason into a canonical abort', async () => {
    const { result } = make()
    result.cancel('just a string')
    const error = await result.completion.catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })

  it('treats an already-aborted caller signal as a cancellation', async () => {
    const controller = new AbortController()
    const reason = new Error('pre-aborted')
    controller.abort(reason)
    const { result } = make({ runId, meta, signal: controller.signal } as never)
    await expect(result.completion).rejects.toBe(reason)
  })

  it('treats a later caller abort exactly like cancel()', async () => {
    const controller = new AbortController()
    const { result, publisher } = make({ runId, meta, signal: controller.signal } as never)
    publisher.publish({ type: 'text-delta', text: 'committed' })
    const reason = new Error('aborted later')
    controller.abort(reason)
    await expect(result.completion).rejects.toBe(reason)
    await expect(drain(result.fullStream)).rejects.toBe(reason)
  })

  it('survives a throwing onCallbackError without skipping the terminal callback', async () => {
    const onFinish = vi.fn()
    const { result, publisher } = make({
      runId,
      meta,
      onChunk: () => {
        throw new Error('callback exploded')
      },
      onCallbackError: () => {
        throw new Error('reporter exploded too')
      },
      onFinish,
    } as never)
    publisher.publish({ type: 'text-delta', text: 'a' })
    publisher.complete({ text: 'a' } as never)
    await result.completion
    // A poisoned queue would have skipped this.
    expect(onFinish).toHaveBeenCalledTimes(1)
  })
})

// The public result's projections must not prefetch either. A default high-water mark
// calls `pull()` once with no reader attached, which advances the shared cursor and
// queues one event INSIDE each projection — a per-surface copy created merely by
// touching the property.
describe('public surfaces do not prefetch', () => {
  it('pulls nothing until a reader attaches', async () => {
    // Observe the PROJECTION, not the producer: a projection pull runs `select()`, which
    // reads `event.type`. An instrumented getter therefore fires exactly when a surface
    // consumes an event — which a producer-side counter can never detect.
    const reads: string[] = []
    const instrumented = (text: string) =>
      ({
        get type() {
          reads.push(text)
          return 'text-delta' as const
        },
        text,
      }) as never

    const { result, publisher } = make()
    void result.textStream
    void result.fullStream
    void result.partialOutputStream

    publisher.publish(instrumented('a'))
    publisher.publish(instrumented('b'))
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // No surface has a reader, so no projection may have consumed anything.
    expect(reads).toEqual([])

    publisher.complete({ text: 'ab' } as never)
    // And every surface still replays the complete sequence once read.
    expect(await drain(result.textStream)).toEqual(['a', 'b'])
    expect(await drain(result.fullStream)).toHaveLength(2)
    expect(await drain(result.partialOutputStream)).toEqual([])
  })
})

describe('cancellation survives a throwing diagnostic reporter', () => {
  it('still rejects with the canonical abort when onCancel AND onCallbackError throw', async () => {
    const { result } = make({
      runId,
      meta,
      onCancel: () => {
        throw new Error('abort hook exploded')
      },
      onCallbackError: () => {
        throw new Error('reporter exploded too')
      },
    } as never)

    result.cancel('not an error')

    const error = await result.completion.catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    // Every surface sees that same identity rather than hanging unsettled.
    await expect(drain(result.fullStream)).rejects.toBe(error)
  })
})
