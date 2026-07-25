/**
 * Structured occurrence gating and copy-on-write rewrite.
 *
 * The occurrence engine gates the root object, a scalar/string/object path, or
 * each array item, in document order. A rewrite replaces the occurrence copy-on-
 * write (never mutating the input), reserializes consistently, and rejects a
 * non-serializable wire value; a block fails closed; a missing optional path
 * emits no occurrence.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { boundary } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { GuardrailBlockedError } from '../../src/safety/guardrail/errors'
import type { GuardrailContext } from '../../src/safety/guardrail/types'
import type { GuardrailBinding } from '../../src/safety/registry'
import { gateStructuredOccurrences } from '../../src/safety/stream/structured-gating'

const ctx: GuardrailContext = {
  promptId: 'p',
  model: 'm',
  messages: [],
  systemPrompt: undefined,
  traceId: undefined,
  metadata: {},
  stream: { segment: true, last: true, heldChars: 0, heldMs: 0 },
}

function bindingFor(guard: ReturnType<typeof guardrail>): GuardrailBinding {
  return {
    kind: 'guardrail',
    policy: guard,
    boundary: (Array.isArray(guard.on) ? guard.on[0] : guard.on) as never,
    scope: 'call',
    mode: guard.mode,
    enabled: true,
  }
}

async function gate(value: unknown, guards: readonly ReturnType<typeof guardrail>[]): Promise<unknown> {
  return gateStructuredOccurrences(value, guards.map(bindingFor), {
    guardContext: ctx,
    appendGuardrailAudit: () => {},
  })
}

describe('structured occurrence gating', () => {
  it('rewrites a scalar path copy-on-write without mutating the input', async () => {
    const input = { account: { email: 'RAW@X.IO' }, score: 1 }
    const frozen = structuredClone(input)
    const result = await gate(input, [
      guardrail({
        id: 'lower-email',
        on: boundary.output.object<{ account: { email: string } }>().path('account.email'),
        run: (email: string) => ({ action: 'rewrite', value: email.toLowerCase(), rewrite: { kind: 'normalize' } }),
      }),
    ])
    expect(result).toEqual({ account: { email: 'raw@x.io' }, score: 1 })
    // Copy-on-write: the original input is untouched.
    expect(input).toEqual(frozen)
  })

  it('rewrites the root object', async () => {
    const result = await gate(
      { a: 1 },
      [
        guardrail({
          id: 'root',
          on: boundary.output.object<{ a: number }>(),
          run: () => ({ action: 'rewrite', value: { a: 2 }, rewrite: { kind: 'normalize' } }),
        }),
      ],
    )
    expect(result).toEqual({ a: 2 })
  })

  it('gates each array item and rewrites in document order', async () => {
    const seen: unknown[] = []
    const result = await gate({ items: [{ n: 1 }, { n: 2 }] }, [
      guardrail({
        id: 'items',
        on: boundary.output.object<{ items: readonly { n: number }[] }>().path('items').items(),
        run: (item: { n: number }) => {
          seen.push(item)
          return { action: 'rewrite', value: { n: item.n * 10 }, rewrite: { kind: 'normalize' } }
        },
      }),
    ])
    expect(seen).toEqual([{ n: 1 }, { n: 2 }])
    expect(result).toEqual({ items: [{ n: 10 }, { n: 20 }] })
  })

  it('fails closed on a block and never returns the tree', async () => {
    const run = vi.fn(() => ({ action: 'block' as const, reason: 'nope' }))
    await expect(
      gate({ v: 'x' }, [
        guardrail({ id: 'blocker', on: boundary.output.object<{ v: string }>().path('v'), run }),
      ]),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('emits no occurrence for a missing optional path', async () => {
    const run = vi.fn(() => ({ action: 'allow' as const }))
    const result = await gate({ present: 1 }, [
      guardrail({ id: 'absent', on: boundary.output.object<{ absent?: string }>().path('absent'), run }),
    ])
    expect(run).not.toHaveBeenCalled()
    expect(result).toEqual({ present: 1 })
  })

  it('rejects a non-serializable rewrite (locally invalid wire value)', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(
      gate({ v: 'x' }, [
        guardrail({
          id: 'bad',
          on: boundary.output.object<{ v: string }>().path('v'),
          run: () => ({ action: 'rewrite', value: cyclic, rewrite: { kind: 'normalize' } }),
        }),
      ]),
    ).rejects.toThrow(/synchronize|serializable/i)
  })

  it('runs occurrence-first in document order (item0/A,B then item1/A,B)', async () => {
    const order: string[] = []
    const on = boundary.output.object<{ items: readonly { n: number }[] }>().path('items').items()
    const a = guardrail({
      id: 'A',
      on,
      run: (item: { n: number }) => {
        order.push(`A${item.n}`)
        return { action: 'allow' as const }
      },
    })
    const b = guardrail({
      id: 'B',
      on,
      run: (item: { n: number }) => {
        order.push(`B${item.n}`)
        return { action: 'allow' as const }
      },
    })
    await gate({ items: [{ n: 0 }, { n: 1 }] }, [a, b])
    // Document order, occurrence-first: both guards for item 0 before item 1.
    expect(order).toEqual(['A0', 'B0', 'A1', 'B1'])
  })

  it('gates each sentence of a string path and reassembles the rewrites', async () => {
    const seen: string[] = []
    const result = await gate({ summary: 'One. Two! Three?' }, [
      guardrail({
        id: 'sentences',
        on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
        run: (sentence: string) => {
          seen.push(sentence)
          return { action: 'rewrite', value: sentence.toUpperCase(), rewrite: { kind: 'normalize' } }
        },
      }),
    ])
    expect(seen).toEqual(['One. ', 'Two! ', 'Three?'])
    expect(result).toEqual({ summary: 'ONE. TWO! THREE?' })
  })

  it('fails closed when a sentence guard blocks one sentence of a string path', async () => {
    await expect(
      gate({ summary: 'Fine. Bad now.' }, [
        guardrail({
          id: 'sentence-block',
          on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
          run: (sentence: string) =>
            sentence.includes('Bad')
              ? { action: 'block' as const, reason: 'nope' }
              : { action: 'allow' as const },
        }),
      ]),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
  })

  it('a rewritten tree reserializes to the same canonical value it parses back to', async () => {
    const result = await gate({ a: { b: 'x' }, c: [1, 2] }, [
      guardrail({
        id: 'nested',
        on: boundary.output.object<{ a: { b: string } }>().path('a.b'),
        run: () => ({ action: 'rewrite', value: 'y', rewrite: { kind: 'normalize' } }),
      }),
    ])
    const text = JSON.stringify(result)
    expect(JSON.parse(text)).toEqual(result)
    expect(result).toEqual({ a: { b: 'y' }, c: [1, 2] })
  })
})
