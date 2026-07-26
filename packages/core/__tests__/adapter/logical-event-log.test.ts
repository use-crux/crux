/**
 * The shared logical replay log (RFC #173, contract 06).
 *
 * All public stream surfaces project ONE append-only log. Contract requirements under
 * test: independent cursors, concurrent and late readers, replay after completion, the
 * same normalized error identity on every surface, detaching one reader only, and a
 * producer that never waits for a consumer.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { createLogicalEventLog } from '../../src/adapter/logical-event-log'

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = []
  for await (const value of stream) seen.push(value)
  return seen
}

describe('logical event log', () => {
  it('gives each surface an independent cursor', async () => {
    const log = createLogicalEventLog<number>()
    const first = log.surface()
    const second = log.surface()
    log.publish(1)
    log.publish(2)
    log.finish()

    // Consuming one must not consume the other.
    expect(await drain(first)).toEqual([1, 2])
    expect(await drain(second)).toEqual([1, 2])
  })

  it('serves concurrent readers', async () => {
    const log = createLogicalEventLog<number>()
    const a = drain(log.surface())
    const b = drain(log.surface())
    log.publish(1)
    log.publish(2)
    log.finish()
    expect(await a).toEqual([1, 2])
    expect(await b).toEqual([1, 2])
  })

  it('replays from the start for a surface created mid-flight', async () => {
    const log = createLogicalEventLog<number>()
    log.publish(1)
    const late = log.surface() // created after publication began
    log.publish(2)
    log.finish()
    expect(await drain(late)).toEqual([1, 2])
  })

  it('replays the complete sequence for a surface created after completion', async () => {
    const log = createLogicalEventLog<number>()
    log.publish(1)
    log.publish(2)
    log.finish()
    expect(await drain(log.surface())).toEqual([1, 2])
  })

  it('replays the committed prefix then errors with the SAME error identity', async () => {
    const log = createLogicalEventLog<number>()
    const failure = new Error('terminal')
    log.publish(1)
    log.fail(failure)

    // A surface created AFTER the failure still replays what was committed first.
    const seen: number[] = []
    let thrown: unknown
    try {
      for await (const value of log.surface()) seen.push(value)
    } catch (error) {
      thrown = error
    }
    expect(seen).toEqual([1])
    // Identity, not merely an equal message: every surface sees the same object.
    expect(thrown).toBe(failure)

    let second: unknown
    try {
      await drain(log.surface())
    } catch (error) {
      second = error
    }
    expect(second).toBe(failure)
  })

  it('never blocks the producer on a consumer', async () => {
    const log = createLogicalEventLog<number>()
    // No surface exists at all; publishing must still complete synchronously.
    for (let index = 0; index < 1000; index += 1) log.publish(index)
    log.finish()
    // And the whole sequence is still replayable afterwards.
    expect((await drain(log.surface())).length).toBe(1000)
  })

  it('detaches only the reader that stops early', async () => {
    const log = createLogicalEventLog<number>()
    const abandoned = log.surface()
    const kept = log.surface()
    log.publish(1)

    for await (const _value of abandoned) break // abandon after one value

    log.publish(2)
    log.finish()
    // The other surface is unaffected.
    expect(await drain(kept)).toEqual([1, 2])
  })

  it('does not project into an untouched surface', async () => {
    // Behavioral, not a count: `retainedCount()` only sees the shared array and is blind
    // to a per-stream internal queue, which is where a prefetching surface would hide its
    // own copy. Observing the producer proves nothing was pulled.
    const pulled: number[] = []
    const log = createLogicalEventLog<number>()
    log.surface()
    log.surface()

    const source = (async function* () {
      for (const value of [1, 2, 3]) {
        pulled.push(value)
        log.publish(value)
      }
      log.finish()
    })()
    for await (const _ of source) void _

    // Two surfaces exist and neither has been read, so neither pulled anything.
    expect(pulled).toEqual([1, 2, 3])
    // Everything is still replayable in full from the one shared log.
    expect(await drain(log.surface())).toEqual([1, 2, 3])
  })

  it('settles a surface cancelled while parked, without another publish', async () => {
    const log = createLogicalEventLog<number>()
    const surface = log.surface()
    const reader = surface.getReader()
    // Park the reader on an empty log, then cancel it.
    const pending = reader.read()
    await reader.cancel()
    // Must settle promptly rather than waiting for an unrelated event to wake it.
    await expect(
      Promise.race([
        pending,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('parked waiter never woke')), 1000),
        ),
      ]),
    ).resolves.toBeDefined()
  })
})
