/**
 * Deterministic text units and bounded fail-closed hold.
 *
 * Custom segmenters receive `{ final }` at EOF to complete a trailing unit; a unit
 * still held at EOF fails closed. Hold limits are enforced on characters and on
 * configured monotonic milliseconds (no implicit wall-clock default). Arbitrary
 * chunk partitions of the same source produce identical released output.
 *
 * @module
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundary, createSafety, guardrail } from '../../src/safety'
import type { SafetyCallOptions } from '../../src/safety'

afterEach(() => {
  vi.restoreAllMocks()
})

const session = (options?: Partial<SafetyCallOptions>) => createSafety({ promptId: 'p1', model: 'm1', ...options })

const allowAll = (options: Parameters<ReturnType<typeof boundary.output.text>['segments']>[0]) =>
  guardrail({ id: 'seg', on: boundary.output.text().segments(options), run: async () => ({ action: 'allow' as const }) })

async function collect(stream: ReturnType<ReturnType<typeof session>['openStream']>, chunks: readonly string[]) {
  let out = ''
  for (const chunk of chunks) {
    const directive = await stream.feed(chunk)
    if (directive.kind === 'emit') out += directive.content
  }
  const seal = await stream.finish()
  return out + seal.pending
}

describe('custom segmenter EOF flushing', () => {
  const pipeSegmenter = {
    maxCharacters: 100,
    // Split on '|'; complete the trailing unit only during the EOF flush.
    next: (buffer: string, { final }: { final: boolean }) => {
      const index = buffer.indexOf('|')
      if (index >= 0) return index + 1
      return final ? buffer.length || undefined : undefined
    },
  }

  it('completes a trailing unterminated unit at EOF via { final: true }', async () => {
    const stream = session({ call: { guardrails: [allowAll(pipeSegmenter)] } }).openStream()
    expect(await collect(stream, ['a|b', 'c'])).toBe('a|bc')
  })

  it('fails closed when a custom segmenter never completes the held tail at EOF', async () => {
    const neverFinal = guardrail({
      id: 'never-final',
      on: boundary.output.text().segments({ maxCharacters: 100, next: () => undefined }),
      run: async () => ({ action: 'allow' as const }),
    })
    const stream = session({ call: { guardrails: [neverFinal] } }).openStream()
    await stream.feed('held forever')
    await expect(stream.finish()).rejects.toThrow(/hold|stream|end of stream/i)
  })
})

describe('bounded hold limits', () => {
  it('fails closed when a held unit exceeds the configured monotonic ms limit', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const held = guardrail({
      id: 'ms-hold',
      // A sentence unit holds until punctuation; no source here ever terminates.
      on: boundary.output.text().sentences({ maxHold: { ms: 50 } }),
      run: async () => ({ action: 'allow' as const }),
    })
    const stream = session({ call: { guardrails: [held] } }).openStream()

    expect(await stream.feed('no end yet')).toEqual({ kind: 'hold' })
    now = 100 // advance the monotonic clock past the 50ms limit
    await expect(stream.feed(' still none')).rejects.toThrow(/hold|ms/i)
  })

  it('does not impose an ms limit when only chars are configured', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const held = guardrail({
      id: 'chars-only',
      on: boundary.output.text().sentences({ maxHold: { chars: 1000 } }),
      run: async () => ({ action: 'allow' as const }),
    })
    const stream = session({ call: { guardrails: [held] } }).openStream()
    expect(await stream.feed('no end yet')).toEqual({ kind: 'hold' })
    now = 10_000 // far past any wall-clock default, but no ms limit is configured
    expect(await stream.feed(' still none')).toEqual({ kind: 'hold' })
    // A terminator (punctuation + whitespace) releases the whole held sentence.
    expect(await stream.feed(' done. ')).toMatchObject({ kind: 'emit' })
  })
})

describe('partition invariance', () => {
  const source = 'First sentence. Second one! Third here?\nFourth line done.'

  const partitions: readonly (readonly string[])[] = [
    [source],
    source.split(''), // one code unit per chunk
    [source.slice(0, 7), source.slice(7, 20), source.slice(20)],
    [source.slice(0, 1), source.slice(1, 2), source.slice(2)],
  ]

  it('sentence units release identical output for any chunk partition', async () => {
    const results: string[] = []
    for (const chunks of partitions) {
      const guard = guardrail({
        id: 'sent',
        on: boundary.output.text().sentences(),
        run: async () => ({ action: 'allow' as const }),
      })
      const stream = session({ call: { guardrails: [guard] } }).openStream()
      results.push(await collect(stream, chunks))
    }
    for (const released of results) expect(released).toBe(source)
  })
})
