/**
 * Session-level structured streaming bridge.
 *
 * `openSafetySessionStructuredStream` binds this call's object bindings to the
 * scanner-fed occurrence gate + release cursor, interprets provider wire-JSON
 * fragments, and seals `{ text, parsed }` from the accepted canonical tree —
 * where `feed releases + pending === text` and `JSON.parse(text) === parsed`.
 * A non-empty sentinel manifest deletes an optional before selection, and a
 * canonical schema validates rewrites before release.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { boundary, createSafety, guardrail } from '../../src/safety'
import { constraint } from '../../src/safety/constraint/define'
import { ConstraintViolationError } from '../../src/safety/constraint/errors'
import { openSafetySessionStructuredStream } from '../../src/safety/session'
import type { StructuredSafetyContext } from '../../src/safety/session'
import type { JsonSchemaObject } from '../../src/adapter/structured-output'

const canonical = (schema: z.ZodType): JsonSchemaObject => z.toJSONSchema(schema, { io: 'input' }) as JsonSchemaObject

async function drive(
  guards: readonly ReturnType<typeof guardrail>[],
  chunks: readonly string[],
  structuredContext?: StructuredSafetyContext,
): Promise<{ released: string; text: string; parsed: unknown }> {
  const safety = createSafety({ promptId: 'p', model: 'm', call: { guardrails: guards } })
  const stream = openSafetySessionStructuredStream(safety, structuredContext)
  let released = ''
  for (const chunk of chunks) {
    const directive = await stream.feed(chunk)
    if (directive.kind === 'emit') released += directive.content
  }
  const seal = await stream.finish()
  return { released: released + seal.pending, text: seal.text, parsed: seal.parsed }
}

describe('session structured streaming bridge', () => {
  it('gates an object path rewrite and seals a consistent {text,parsed}', async () => {
    const result = await drive(
      [
        guardrail({
          id: 'redact-a',
          on: boundary.output.object<{ a: string; b: string }>().path('a'),
          run: () => ({ action: 'rewrite', value: 'X', rewrite: { kind: 'redact' } }),
        }),
      ],
      ['{"a":"raw",', '"b":"keep"}'],
    )
    expect(result.text).toBe('{"a":"X","b":"keep"}')
    expect(result.parsed).toEqual({ a: 'X', b: 'keep' })
    expect(result.released).toBe(result.text)
  })

  it('validates a streamed rewrite against the canonical schema before release', async () => {
    const schema = z.object({ name: z.string().min(3) })
    const context: StructuredSafetyContext = { canonicalSchema: canonical(schema) }
    await expect(
      drive(
        [
          guardrail({
            id: 'too-short',
            on: boundary.output.object<{ name: string }>().path('name'),
            run: () => ({ action: 'rewrite', value: 'ab', rewrite: { kind: 'normalize' } }),
          }),
        ],
        ['{"name":"alice"}'],
        context,
      ),
    ).rejects.toThrow(/synchronize|schema/i)
  })

  it('gates each occurrence exactly once during streaming (no double-gate)', async () => {
    const scalar = vi.fn(() => ({ action: 'allow' as const }))
    const perItem = vi.fn((item: unknown) => ({ action: 'allow' as const, _seen: item }))
    await drive(
      [
        guardrail({ id: 'scalar', on: boundary.output.object<{ a: string }>().path('a'), run: scalar }),
        guardrail({
          id: 'each-item',
          on: boundary.output.object<{ items: readonly number[] }>().path('items').items(),
          run: perItem,
        }),
      ],
      ['{"a":"x","items":[1,', '2,3]}'],
    )
    // Scalar path gated once; the item guard once per array element — never re-run
    // at completion (the sealed canonical value is consumed directly downstream).
    expect(scalar).toHaveBeenCalledTimes(1)
    expect(perItem).toHaveBeenCalledTimes(3)
  })

  it('deletes a null sentinel before selection, then rewrites a sibling (non-empty manifest)', async () => {
    const context: StructuredSafetyContext = {
      decodeManifest: { version: 1, operations: [{ kind: 'delete-null-sentinel', path: ['note'] }] },
    }
    const result = await drive(
      [
        guardrail({
          id: 'upper-name',
          on: boundary.output.object<{ name: string; note?: string }>().path('name'),
          run: (name: string) => ({ action: 'rewrite', value: name.toUpperCase(), rewrite: { kind: 'normalize' } }),
        }),
      ],
      ['{"name":"amy",', '"note":null}'],
      context,
    )
    expect(result.parsed).toEqual({ name: 'AMY' }) // sentinel deleted, sibling rewritten
    expect(result.text).toBe('{"name":"AMY"}')
    expect(result.released).toBe(result.text)
  })

  it('gates a model.output.text guard over the canonical serialized text and resyncs the object', async () => {
    const seen: string[] = []
    const result = await drive(
      [
        guardrail({
          id: 'text-redact',
          on: boundary.output.text(),
          run: (text: string) => {
            seen.push(text)
            return { action: 'rewrite', value: text.replace('raw', 'safe'), rewrite: { kind: 'redact' } }
          },
        }),
      ],
      ['{"name":"ra', 'w"}'],
    )
    // The guard observes canonical serialized JSON (never provider wire text), and
    // the object resynchronizes from the accepted rewritten text.
    expect(seen.join('')).toBe('{"name":"raw"}')
    expect(result.text).toBe('{"name":"safe"}')
    expect(result.parsed).toEqual({ name: 'safe' })
    expect(JSON.parse(result.text)).toEqual(result.parsed)
    expect(result.released).toBe(result.text)
  })

  it('composes object-occurrence gating then canonical text gating on the same stream', async () => {
    const result = await drive(
      [
        guardrail({
          id: 'obj',
          on: boundary.output.object<{ name: string }>().path('name'),
          run: () => ({ action: 'rewrite', value: 'X', rewrite: { kind: 'redact' } }),
        }),
        guardrail({
          id: 'text',
          on: boundary.output.text(),
          run: (text: string) => ({ action: 'rewrite', value: text.replace('"X"', '"Y"'), rewrite: { kind: 'normalize' } }),
        }),
      ],
      ['{"name":"raw"}'],
    )
    // Object gate: name → "X"; then the text gate sees canonical `{"name":"X"}` and
    // rewrites to `{"name":"Y"}`; the object resyncs to match the exposed text.
    expect(result.text).toBe('{"name":"Y"}')
    expect(result.parsed).toEqual({ name: 'Y' })
  })

  it('an assert constraint holds a session structured stream to completion (bufferedBy constraint)', async () => {
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        constraints: [
          constraint({
            id: 'positive',
            on: boundary.output.object<{ a: number }>(),
            run: (obj: { a: number }) => (obj.a > 0 ? { pass: true } : { pass: false, feedback: 'not positive' }),
          }),
        ],
      },
    })
    const stream = openSafetySessionStructuredStream(safety)
    const directive = await stream.feed('{"a":1}')
    expect(directive.kind).toBe('hold')
    if (directive.kind === 'hold') expect(directive.bufferedBy).toBe('constraint')
    const seal = await stream.finish()
    expect(seal.text).toBe('{"a":1}')
    expect(seal.parsed).toEqual({ a: 1 })
  })

  it('an assert constraint fails a standalone structured stream closed', async () => {
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        constraints: [
          constraint({
            id: 'positive',
            on: boundary.output.object<{ a: number }>(),
            run: (obj: { a: number }) => (obj.a > 0 ? { pass: true } : { pass: false, feedback: 'not positive' }),
          }),
        ],
      },
    })
    const stream = openSafetySessionStructuredStream(safety)
    await stream.feed('{"a":-1}')
    await expect(stream.finish()).rejects.toBeInstanceOf(ConstraintViolationError)
  })

  it('gates a string path by sentence over the decoded value (escape-safe)', async () => {
    const seen: string[] = []
    const result = await drive(
      [
        guardrail({
          id: 'summary-sentences',
          on: boundary.output.object<{ summary: string }>().path('summary').sentences(),
          run: (sentence: string) => {
            seen.push(sentence)
            return { action: 'rewrite', value: sentence.replace('secret', '[redacted]'), rewrite: { kind: 'redact' } }
          },
        }),
      ],
      // The wire string carries a JSON escape (\") — the guard sees the decoded text.
      ['{"summary":"Hi there. A \\"secret\\" leaked."}'],
    )
    expect(seen).toEqual(['Hi there. ', 'A "secret" leaked.'])
    expect(result.parsed).toEqual({ summary: 'Hi there. A "[redacted]" leaked.' })
    // The released text re-encodes the escape and round-trips.
    expect(JSON.parse(result.text)).toEqual(result.parsed)
    expect(result.released).toBe(result.text)
  })
})
