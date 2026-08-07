/**
 * Streaming structured occurrence gating + monotonic release cursor.
 *
 * A path/item guard releases the earliest safe ordered prefix (never buffering the
 * whole response); a root or enclosing object-path guard buffers its subtree until
 * it closes and passes; sentinel-null deletion happens before selection; rewrites
 * are copy-on-write and reserialized; a block releases nothing; and the sealed
 * `{ text, parsed }` both derive from the accepted canonical tree with
 * `feed releases + pending === text` and `JSON.parse(text) === parsed`.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { boundary } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { GuardrailBlockedError } from '../../src/safety/guardrail/errors'
import type { GuardrailContext } from '../../src/safety/guardrail/types'
import type { GuardrailBinding } from '../../src/safety/registry'
import type { StructuredOutputDecodeManifest } from '../../src/adapter/structured-output'
import { createStructuredStreamGate } from '../../src/safety/stream/structured-stream-gate'

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

interface RunResult {
  readonly feedReleases: readonly string[]
  readonly released: string
  readonly text: string
  readonly parsed: unknown
}

async function run(
  guards: readonly ReturnType<typeof guardrail>[],
  wireChunks: readonly string[],
  manifest?: StructuredOutputDecodeManifest,
): Promise<RunResult> {
  const gate = createStructuredStreamGate({
    objectBindings: guards.map(bindingFor),
    ...(manifest ? { manifest } : {}),
    guardContext: ctx,
    appendGuardrailAudit: () => {},
  })
  const feedReleases: string[] = []
  for (const chunk of wireChunks) feedReleases.push(await gate.feed(chunk))
  const seal = await gate.finish()
  return { feedReleases, released: feedReleases.join('') + seal.pending, text: seal.text, parsed: seal.parsed }
}

/** Every run must satisfy: released stream === sealed text === reserialized parsed tree. */
function assertSealInvariants(result: RunResult): void {
  expect(result.released).toBe(result.text)
  expect(JSON.parse(result.text)).toEqual(result.parsed)
}

describe('streaming structured release cursor', () => {
  it('releases a scalar-path prefix progressively (no whole-response buffering)', async () => {
    const result = await run(
      [
        guardrail({
          id: 'redact',
          on: boundary.output.object<{ a: string; b: string }>().path('a'),
          run: () => ({ action: 'rewrite', value: 'X', rewrite: { kind: 'redact' } }),
        }),
      ],
      ['{"a":"raw",', '"b":"keep"}'],
    )
    assertSealInvariants(result)
    expect(result.text).toBe('{"a":"X","b":"keep"}')
    // The gated 'a' prefix released before 'b' arrived — not one buffered response.
    expect(result.feedReleases[0]).toBe('{"a":"X"')
  })

  it('a root object guard buffers the whole subtree until root close', async () => {
    const result = await run(
      [
        guardrail({
          id: 'root',
          on: boundary.output.object<{ a: number; b: number }>(),
          run: () => ({ action: 'allow' as const }),
        }),
      ],
      ['{"a":1,', '"b":2', '}'],
    )
    assertSealInvariants(result)
    // Every feed before the root closes releases nothing; it seals at root close.
    expect(result.feedReleases[0]).toBe('')
    expect(result.feedReleases[1]).toBe('')
    expect(result.feedReleases[2]).toBe('{"a":1,"b":2}')
    expect(result.text).toBe('{"a":1,"b":2}')
  })

  it('an enclosing object-path guard buffers its subtree until it closes and passes', async () => {
    const result = await run(
      [
        guardrail({
          id: 'obj',
          on: boundary.output.object<{ obj: { x: number }; y: number }>().path('obj'),
          run: () => ({ action: 'allow' as const }),
        }),
      ],
      // `obj` stays open across the middle feed; its internals must not leak then.
      ['{"obj":{', '"x":1', '}', ',"y":2}'],
    )
    assertSealInvariants(result)
    // While obj is open, its internal bytes are held (no `x` released).
    expect(result.feedReleases[1]).not.toContain('x')
    expect(result.text).toBe('{"obj":{"x":1},"y":2}')
  })

  it('deletes a null sentinel before path selection; a guard on it never fires', async () => {
    const run1 = vi.fn(() => ({ action: 'allow' as const }))
    const manifest: StructuredOutputDecodeManifest = {
      version: 1,
      operations: [{ kind: 'delete-null-sentinel', path: ['note'] }],
    }
    const result = await run(
      [guardrail({ id: 'note', on: boundary.output.object<{ note?: string }>().path('note'), run: run1 })],
      ['{"name":"a","note":null}'],
      manifest,
    )
    assertSealInvariants(result)
    expect(result.parsed).toEqual({ name: 'a' }) // sentinel deleted from canonical
    expect(run1).not.toHaveBeenCalled()
  })

  it('applies a guarded sentinel only on its union branch (discriminator first)', async () => {
    const manifest: StructuredOutputDecodeManifest = {
      version: 2,
      operations: [
        {
          kind: 'delete-null-sentinel',
          path: ['x'],
          guards: [{ depth: 0, key: 'status', value: 'a' }],
        },
      ],
    }
    // Branch "a": null is a transport sentinel and is deleted from the canonical.
    const sentinel = await run([], ['{"status":"a","x":null}'], manifest)
    assertSealInvariants(sentinel)
    expect(sentinel.parsed).toEqual({ status: 'a' })
    // Branch "b": the same path holds a genuine authored null that must survive.
    const genuine = await run([], ['{"status":"b","x":null}'], manifest)
    assertSealInvariants(genuine)
    expect(genuine.parsed).toEqual({ status: 'b', x: null })
  })

  it('holds a guarded sentinel decision until a late discriminator arrives', async () => {
    const manifest: StructuredOutputDecodeManifest = {
      version: 1,
      operations: [
        {
          kind: 'delete-null-sentinel',
          path: ['x'],
          guards: [{ depth: 0, key: 'status', value: 'a' }],
        },
      ],
    }
    // The null streams before its discriminator; the genuine branch-"b" null is
    // restored to the canonical tree once the enclosing object closes.
    const genuine = await run([], ['{"x":null,', '"status":"b"}'], manifest)
    assertSealInvariants(genuine)
    expect(genuine.parsed).toEqual({ status: 'b', x: null })
    // Same ordering on branch "a": the sentinel stays deleted.
    const sentinel = await run([], ['{"x":null,', '"status":"a"}'], manifest)
    assertSealInvariants(sentinel)
    expect(sentinel.parsed).toEqual({ status: 'a' })
  })

  it('preserves a genuine null value as an occurrence', async () => {
    const seen: unknown[] = []
    const result = await run(
      [
        guardrail({
          id: 'keep-null',
          on: boundary.output.object<{ keep: string | null }>().path('keep'),
          run: (value: unknown) => {
            seen.push(value)
            return { action: 'allow' as const }
          },
        }),
      ],
      ['{"keep":null}'],
    )
    assertSealInvariants(result)
    expect(result.parsed).toEqual({ keep: null })
    expect(seen).toEqual([null])
  })

  it('a length-changing item rewrite reserializes and reparses consistently', async () => {
    const result = await run(
      [
        guardrail({
          id: 'items',
          on: boundary.output.object<{ items: readonly string[] }>().path('items').items(),
          run: (item: string) => ({ action: 'rewrite', value: `${item}-longer`, rewrite: { kind: 'normalize' } }),
        }),
      ],
      ['{"items":["a",', '"b"]}'],
    )
    assertSealInvariants(result)
    expect(result.parsed).toEqual({ items: ['a-longer', 'b-longer'] })
  })

  it('releases each array item at its close (earliest-safe prefix, not buffered to array close)', async () => {
    const result = await run(
      [
        guardrail({
          id: 'upper-items',
          on: boundary.output.object<{ items: readonly string[] }>().path('items').items(),
          run: (item: string) => ({ action: 'rewrite', value: item.toUpperCase(), rewrite: { kind: 'normalize' } }),
        }),
      ],
      // item 0 ("a") closes in the first feed; item 1 ("b") in the second.
      ['{"items":["a"', ',"b"]}'],
    )
    assertSealInvariants(result)
    expect(result.parsed).toEqual({ items: ['A', 'B'] })
    // An `.items()` selector is not an enclosing gate, so item 0's rewritten prefix
    // releases before item 1 arrives — the array is not buffered to its close.
    expect(result.feedReleases[0]).toContain('A')
    expect(result.feedReleases[0]).not.toContain('B')
  })

  it('releases completed sentences of a growing string before its closing quote', async () => {
    const result = await run(
      [
        guardrail({
          id: 'sentences',
          on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
          run: (sentence: string) => ({ action: 'rewrite', value: sentence.toUpperCase(), rewrite: { kind: 'normalize' } }),
        }),
      ],
      ['{"summary":"One. Tw', 'o! Three?"}'],
    )
    assertSealInvariants(result)
    expect(result.parsed).toEqual({ summary: 'ONE. TWO! THREE?' })
    // The first sentence releases in the first feed — the string's closing quote
    // (and the still-incomplete second sentence) are withheld.
    expect(result.feedReleases[0]).toContain('ONE. ')
    expect(result.feedReleases[0]).not.toContain('TWO')
    expect(result.feedReleases[0]).not.toContain('"}')
  })

  it('gates a sentence string with escapes and surrogates split across chunks', async () => {
    const seen: string[] = []
    const result = await run(
      [
        guardrail({
          id: 'record-sentences',
          on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
          run: (sentence: string) => {
            seen.push(sentence)
            return { action: 'allow' as const }
          },
        }),
      ],
      // A quote escape and an astral emoji (surrogate pair) split across feeds.
      ['{"summary":"Hi \\uD83D', '\\uDE00 there. D', 'one \\"q\\"."}'],
    )
    assertSealInvariants(result)
    // The guard observes fully-decoded sentences (emoji + unescaped quote).
    expect(seen).toEqual(['Hi \u{1F600} there. ', 'Done "q".'])
    expect(result.parsed).toEqual({ summary: 'Hi \u{1F600} there. Done "q".' })
    expect(JSON.parse(result.text)).toEqual(result.parsed)
  })

  it('fails closed on a sentence block before the affected bytes release', async () => {
    await expect(
      run(
        [
          guardrail({
            id: 'sentence-block',
            on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
            run: (sentence: string) =>
              sentence.includes('bad') ? { action: 'block' as const, reason: 'no' } : { action: 'allow' as const },
          }),
        ],
        ['{"summary":"Fine. This is bad."}'],
      ),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
  })

  it('sentence gating over a growing string is invariant across chunk partitions', async () => {
    const source = '{"summary":"First one. Second \\"q\\" two. Third \\uD83D\\uDE00 three."}'
    const guards = () => [
      guardrail({
        id: 'upper',
        on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
        run: (sentence: string) => ({ action: 'rewrite', value: sentence.toUpperCase(), rewrite: { kind: 'normalize' } }),
      }),
    ]
    const partitions: readonly (readonly string[])[] = [
      [source],
      source.split(''), // one wire code unit per chunk
      [source.slice(0, 12), source.slice(12, 33), source.slice(33)],
    ]
    const results = []
    for (const chunks of partitions) results.push(await run(guards(), chunks))
    for (const result of results) {
      assertSealInvariants(result)
      expect(result.parsed).toEqual(results[0]!.parsed)
      expect(result.text).toBe(results[0]!.text)
    }
    expect(results[0]!.parsed).toEqual({ summary: 'FIRST ONE. SECOND "Q" TWO. THIRD \u{1F600} THREE.' })
  })

  it('fails closed when a growing sentence string never closes', async () => {
    const gate = createStructuredStreamGate({
      objectBindings: [
        bindingFor(
          guardrail({
            id: 'sent-open',
            on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
            run: () => ({ action: 'allow' as const }),
          }),
        ),
      ],
      guardContext: ctx,
      appendGuardrailAudit: () => {},
    })
    await gate.feed('{"summary":"One. Two')
    await expect(gate.finish()).rejects.toThrow()
  })

  it('a block on a path releases nothing and fails closed', async () => {
    await expect(
      run(
        [
          guardrail({
            id: 'blocker',
            on: boundary.output.object<{ a: string }>().path('a'),
            run: () => ({ action: 'block' as const, reason: 'nope' }),
          }),
        ],
        ['{"a":"bad"}'],
      ),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
  })
})

// Occurrence paths identify which gate engine handles a value. A delimiter-joined key
// is not injective: a property name containing the delimiter forges another path's key,
// so the wrong policy would run on that value. The encoding must keep these distinct.
describe('occurrence path identity is unambiguous', () => {
  it('separates paths a NUL-delimited key would collide', () => {
    // Mirrors the gate's internal encoding.
    const key = (path: readonly (string | number)[]): string => JSON.stringify(path)
    // The historical encoding was `${typeof s}:${s}` joined by NUL, making these equal.
    expect(key(['a' + '\x00' + 'string:b'])).not.toBe(key(['a', 'b']))
    expect(key(['a:b'])).not.toBe(key(['a', 'b']))
    expect(key([1])).not.toBe(key(['1']))
    expect(key(['a', 'b'])).not.toBe(key(['a.b']))
  })
})
